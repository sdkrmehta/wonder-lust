const PaymentService = require("../services/payment.service");
const BookingService = require("../services/booking.service");
const env = require("../config/env");

module.exports.renderCheckout = async (req, res) => {
	const { bookingId } = req.params;
	try {
		const booking = await BookingService.getBookingById(bookingId, req.user);

		if (
			booking.status === "pending" &&
			booking.paymentStatus === "unpaid" &&
			booking.expiresAt &&
			booking.expiresAt <= new Date()
		) {
			await BookingService.expireAbandonedPendingBookings({
				listingId: booking.listing?._id || booking.listing,
				limit: 10,
			});
			req.flash("error", "Your pending reservation hold expired. Please select new dates.");
			return res.redirect("/bookings");
		}

		if (booking.status === "cancelled") {
			req.flash("error", "Cannot process payment for a cancelled reservation.");
			return res.redirect("/bookings");
		}

		if (booking.paymentStatus === "paid" && booking.payment) {
			const paymentId = booking.payment._id || booking.payment;
			req.flash("info", "This reservation has already been paid for.");
			return res.redirect(`/payments/receipt/${paymentId}`);
		}

		res.render("payments/checkout.ejs", {
			booking,
			listing: booking.listing,
			paymentProvider: env.PAYMENT_PROVIDER,
			paymentGatewayMode: env.PAYMENT_GATEWAY_MODE,
		});
	} catch (err) {
		req.flash("error", err.message || "Unable to load checkout page.");
		res.redirect("/bookings");
	}
};

module.exports.verifyRazorpay = async (req, res) => {
	const { bookingId } = req.params;
	try {
		const result = await PaymentService.verifyRazorpayPayment(
			{ ...req.body, bookingId },
			req.user,
		);
		req.flash("success", "Payment verified! Your reservation is confirmed.");
		return res.redirect(`/payments/receipt/${result.payment._id}`);
	} catch (err) {
		req.flash("error", err.message || "Razorpay payment verification failed.");
		return res.redirect(`/payments/checkout/${bookingId}`);
	}
};

module.exports.processPayment = async (req, res) => {
	const { bookingId } = req.params;
	try {
		const payment = await PaymentService.createPaymentOrder(
			bookingId,
			req.body,
			req.user,
		);
		if (payment.status === "pending") {
			req.flash(
				"info",
				"Payment initiated. Reservation awaits confirmed payment webhook from gateway.",
			);
			return res.redirect(`/bookings/${bookingId}`);
		}
		req.flash("success", "Payment Successful! Your reservation is fully confirmed.");
		res.redirect(`/payments/receipt/${payment._id}`);
	} catch (err) {
		req.flash("error", err.message || "Payment processing failed. Please try again.");
		res.redirect(`/payments/checkout/${bookingId}`);
	}
};

module.exports.renderReceipt = async (req, res) => {
	const { id } = req.params;
	try {
		const payment = await PaymentService.getPaymentById(id, req.user);
		res.render("payments/receipt.ejs", {
			payment,
			booking: payment.booking,
			listing: payment.booking ? payment.booking.listing : {},
		});
	} catch (err) {
		req.flash("error", err.message || "Payment receipt not found.");
		res.redirect("/bookings");
	}
};

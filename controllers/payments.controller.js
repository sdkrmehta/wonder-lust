const PaymentService = require("../services/payment.service");
const BookingService = require("../services/booking.service");

module.exports.renderCheckout = async (req, res) => {
	const { bookingId } = req.params;
	try {
		const booking = await BookingService.getBookingById(bookingId, req.user);

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
		});
	} catch (err) {
		req.flash("error", err.message || "Unable to load checkout page.");
		res.redirect("/bookings");
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

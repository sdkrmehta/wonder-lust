const PaymentService = require("../services/payment.service");
const BookingService = require("../services/booking.service");
const UserService = require("../services/user.service");
const env = require("../config/env");
const { SUPPORTED_COUNTRIES } = require("../utils/addressValidation");

function buildBillingDefaults(booking, user) {
	const savedBilling = booking && booking.billingAddress && booking.billingAddress.addressLine1
		? booking.billingAddress
		: null;
	const source = savedBilling || user || {};
	return {
		fullName: source.fullName || user?.fullName || user?.username || "",
		email: source.email || user?.email || "",
		phone: source.phone || user?.phone || "",
		addressLine1: source.addressLine1 || source.address || user?.addressLine1 || user?.address || "",
		addressLine2: source.addressLine2 || "",
		landmark: source.landmark || "",
		city: source.city || "",
		state: source.state || "",
		postalCode: source.postalCode || "",
		country: source.country || "India",
	};
}

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

		const freshUser = (await UserService.getUserById(req.user._id)) || req.user;
		const billingDefaults = buildBillingDefaults(booking, freshUser);
		const gatewayConfigured =
			env.PAYMENT_PROVIDER === "razorpay"
				? Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET)
				: env.PAYMENT_PROVIDER === "internal" ||
						env.isProduction ||
						env.PAYMENT_GATEWAY_MODE === "strict"
					? env.PAYMENT_WEBHOOK_SECRET.length >= 32
					: true;

		res.render("payments/checkout.ejs", {
			booking,
			listing: booking.listing,
			billingDefaults,
			countries: SUPPORTED_COUNTRIES,
			paymentProvider: env.PAYMENT_PROVIDER,
			paymentGatewayMode: env.PAYMENT_GATEWAY_MODE,
			gatewayConfigured,
		});
	} catch (err) {
		req.flash("error", err.message || "Unable to load checkout page.");
		res.redirect("/bookings");
	}
};

module.exports.processPayment = async (req, res) => {
	const { bookingId } = req.params;
	try {
		const requestBaseUrl = `${req.protocol}://${req.get("host")}`;
		const payment = await PaymentService.createPaymentLink(
			bookingId,
			req.body,
			req.user,
			{
				requestBaseUrl,
				requireBillingDetails: true,
			},
		);

		if (payment.paymentLink && payment.paymentLink.shortUrl) {
			return res.redirect(payment.paymentLink.shortUrl);
		}

		if (payment.status === "pending" || payment.status === "created") {
			req.flash(
				"info",
				"Payment initiated. Reservation awaits confirmed payment webhook from gateway.",
			);
			return res.redirect(`/bookings/${bookingId}`);
		}

		req.flash("success", "Payment Successful! Your reservation is fully confirmed.");
		return res.redirect(`/payments/receipt/${payment._id}`);
	} catch (err) {
		req.flash("error", err.message || "Payment processing failed. Please try again.");
		return res.redirect(`/payments/checkout/${bookingId}`);
	}
};

module.exports.handleRazorpayCallback = async (req, res) => {
	try {
		const result = await PaymentService.verifyRazorpayPaymentLinkCallback(
			req.query,
			req.user,
		);
		req.flash("success", "Payment verified! Your reservation is confirmed.");
		return res.redirect(`/payments/receipt/${result.payment._id}`);
	} catch (err) {
		req.flash("error", err.message || "Razorpay Payment Link verification failed.");
		if (err.bookingId) {
			return res.redirect(`/payments/checkout/${err.bookingId}`);
		}
		return res.redirect("/bookings");
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

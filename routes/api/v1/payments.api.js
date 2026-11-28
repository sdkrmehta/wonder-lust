const express = require("express");
const router = express.Router();
const wrapAsync = require("../../../utils/wrapAsync");
const ApiResponse = require("../../../utils/apiResponse");
const AppError = require("../../../utils/AppError");
const PaymentService = require("../../../services/payment.service");
const {
	isLoggedIn,
	validatePayment,
	validateCheckoutPaymentLink,
	validateRazorpayVerify,
	validateRazorpayPaymentLinkCallback,
} = require("../../../middleware");

// POST /api/v1/payments/webhook - Cryptographically signed payment gateway webhook (Razorpay / Internal)
router.post(
	"/webhook",
	wrapAsync(async (req, res) => {
		const sigHeaders = {
			paymentSignature: req.get("x-payment-signature") || req.get("stripe-signature") || "",
			razorpaySignature: req.get("x-razorpay-signature") || "",
			razorpayEventId: req.get("x-razorpay-event-id") || "",
		};
		if (!Buffer.isBuffer(req.rawBody)) {
			throw AppError.badRequest(
				"Raw JSON request body is required for webhook signature verification",
			);
		}
		const result = await PaymentService.processWebhookEvent(req.rawBody, sigHeaders, req.body);
		return ApiResponse.success(
			res,
			{
				paymentId: result.payment ? result.payment._id : null,
				orderId: result.payment ? result.payment.orderId : null,
				paymentLinkId: result.payment ? result.payment.paymentLinkId : null,
				gateway: result.payment ? result.payment.gateway : "razorpay",
				status: result.payment ? result.payment.status : null,
				webhookVerified: result.payment ? result.payment.webhookVerified : true,
				idempotent: result.idempotent,
			},
			result.idempotent ? "Webhook event already processed" : "Webhook verified and processed",
		);
	}),
);

// POST /api/v1/payments/payment-links - Create Razorpay Hosted Payment Link for booking
router.post(
	"/payment-links",
	isLoggedIn,
	validateCheckoutPaymentLink,
	wrapAsync(async (req, res) => {
		const { bookingId } = req.body;
		const requestBaseUrl = `${req.protocol}://${req.get("host")}`;
		const payment = await PaymentService.createPaymentLink(
			bookingId,
			req.body,
			req.user,
			{ requestBaseUrl, requireBillingDetails: true },
		);
		const message =
			payment.paymentLink && payment.paymentLink.shortUrl
				? "Razorpay Payment Link created successfully"
				: "Payment initiated successfully";
		return ApiResponse.created(res, payment, message);
	}),
);

// POST /api/v1/payments/razorpay/verify-link - Verify Razorpay Payment Link callback signature
router.post(
	"/razorpay/verify-link",
	isLoggedIn,
	validateRazorpayPaymentLinkCallback,
	wrapAsync(async (req, res) => {
		const result = await PaymentService.verifyRazorpayPaymentLinkCallback(req.body, req.user);
		return ApiResponse.success(
			res,
			{
				payment: result.payment,
				bookingId: result.booking._id,
				idempotent: result.idempotent,
				redirectUrl: `/payments/receipt/${result.payment._id}`,
			},
			"Razorpay Payment Link verified and confirmed",
		);
	}),
);

// POST /api/v1/payments/razorpay/verify - Verify legacy Razorpay Order Checkout callback signature
router.post(
	"/razorpay/verify",
	isLoggedIn,
	validateRazorpayVerify,
	wrapAsync(async (req, res) => {
		const result = await PaymentService.verifyRazorpayPayment(req.body, req.user);
		return ApiResponse.success(
			res,
			{
				payment: result.payment,
				bookingId: result.booking._id,
				idempotent: result.idempotent,
				redirectUrl: `/payments/receipt/${result.payment._id}`,
			},
			"Razorpay payment verified and confirmed",
		);
	}),
);

// POST /api/v1/payments/create-order - Create Payment Link / initiate payment
router.post(
	"/create-order",
	isLoggedIn,
	validatePayment,
	wrapAsync(async (req, res) => {
		const { bookingId } = req.body;
		const requestBaseUrl = `${req.protocol}://${req.get("host")}`;
		const payment = await PaymentService.createPaymentLink(
			bookingId,
			req.body,
			req.user,
			{ requestBaseUrl, requireBillingDetails: false },
		);
		const message =
			payment.status === "pending" || payment.status === "created"
				? "Payment initiated and awaiting gateway confirmation"
				: "Payment order processed successfully";
		return ApiResponse.created(res, payment, message);
	}),
);

// POST /api/v1/payments/process/:bookingId - Direct payment initiation
router.post(
	"/process/:bookingId",
	isLoggedIn,
	validatePayment,
	wrapAsync(async (req, res) => {
		const { bookingId } = req.params;
		const requestBaseUrl = `${req.protocol}://${req.get("host")}`;
		const payment = await PaymentService.createPaymentLink(
			bookingId,
			req.body,
			req.user,
			{ requestBaseUrl, requireBillingDetails: false },
		);
		const message =
			payment.status === "pending" || payment.status === "created"
				? "Payment initiated and awaiting gateway confirmation"
				: "Payment completed successfully";
		return ApiResponse.success(res, payment, message);
	}),
);

// GET /api/v1/payments/:id - Retrieve single payment invoice
router.get(
	"/:id",
	isLoggedIn,
	wrapAsync(async (req, res) => {
		const payment = await PaymentService.getPaymentById(req.params.id, req.user);
		return ApiResponse.success(res, payment);
	}),
);

// GET /api/v1/payments/booking/:bookingId - Retrieve payment by booking
router.get(
	"/booking/:bookingId",
	isLoggedIn,
	wrapAsync(async (req, res) => {
		const payment = await PaymentService.getPaymentByBooking(
			req.params.bookingId,
			req.user,
		);
		return ApiResponse.success(res, payment);
	}),
);

// POST /api/v1/payments/:bookingId/refund - Process refund for booking
router.post(
	"/:bookingId/refund",
	isLoggedIn,
	wrapAsync(async (req, res) => {
		const refund = await PaymentService.processRefund(
			req.params.bookingId,
			req.user,
			req.body.reason || "Refund requested by traveler",
		);
		return ApiResponse.success(res, refund, "Payment refunded successfully");
	}),
);

module.exports = router;

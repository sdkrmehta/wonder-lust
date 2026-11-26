const express = require("express");
const router = express.Router();
const wrapAsync = require("../../../utils/wrapAsync");
const ApiResponse = require("../../../utils/apiResponse");
const PaymentService = require("../../../services/payment.service");
const { isLoggedIn, validatePayment } = require("../../../middleware");

// POST /api/v1/payments/webhook - Cryptographically signed payment gateway webhook
router.post(
	"/webhook",
	wrapAsync(async (req, res) => {
		const sig = req.get("x-payment-signature") || req.get("stripe-signature") || "";
		const rawBody = req.rawBody !== undefined ? req.rawBody : JSON.stringify(req.body || {});
		const result = await PaymentService.processWebhookEvent(rawBody, sig, req.body);
		return ApiResponse.success(
			res,
			{
				paymentId: result.payment._id,
				orderId: result.payment.orderId,
				status: result.payment.status,
				webhookVerified: result.payment.webhookVerified,
				idempotent: result.idempotent,
			},
			result.idempotent ? "Webhook event already processed" : "Webhook verified and processed",
		);
	}),
);

// POST /api/v1/payments/create-order - Create order / initiate payment
router.post(
	"/create-order",
	isLoggedIn,
	validatePayment,
	wrapAsync(async (req, res) => {
		const { bookingId } = req.body;
		const payment = await PaymentService.createPaymentOrder(
			bookingId,
			req.body,
			req.user,
		);
		const message =
			payment.status === "pending"
				? "Payment order created and awaiting signed gateway webhook confirmation"
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
		const payment = await PaymentService.createPaymentOrder(
			bookingId,
			req.body,
			req.user,
		);
		const message =
			payment.status === "pending"
				? "Payment initiated and awaiting signed gateway webhook confirmation"
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

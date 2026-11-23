const express = require("express");
const router = express.Router();
const wrapAsync = require("../../../utils/wrapAsync");
const ApiResponse = require("../../../utils/apiResponse");
const PaymentService = require("../../../services/payment.service");
const { isLoggedIn, validatePayment } = require("../../../middleware");

// POST /api/v1/payments/create-order - Create order / process payment
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
		return ApiResponse.created(res, payment, "Payment order processed successfully");
	}),
);

// POST /api/v1/payments/process/:bookingId - Direct payment execution
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
		return ApiResponse.success(res, payment, "Payment completed successfully");
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

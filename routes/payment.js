const express = require("express");
const router = express.Router();
const wrapAsync = require("../utils/wrapAsync");
const { isLoggedIn, validatePayment } = require("../middleware");
const paymentsController = require("../controllers/payments");

// GET /payments/checkout/:bookingId - Render checkout payment form
router.get("/checkout/:bookingId", isLoggedIn, wrapAsync(paymentsController.renderCheckout));

// POST /payments/process/:bookingId - Process payment
router.post(
	"/process/:bookingId",
	isLoggedIn,
	validatePayment,
	wrapAsync(paymentsController.processPayment),
);

// GET /payments/receipt/:id - Render printable invoice & payment receipt
router.get("/receipt/:id", isLoggedIn, wrapAsync(paymentsController.renderReceipt));

module.exports = router;

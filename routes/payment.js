const express = require("express");
const router = express.Router();
const wrapAsync = require("../utils/wrapAsync");
const {
	isLoggedIn,
	validateCheckoutPaymentLink,
	validateRazorpayVerify,
	validateRazorpayPaymentLinkCallback,
} = require("../middleware");
const paymentsController = require("../controllers/payments");

// GET /payments/checkout/:bookingId - Render checkout billing & summary page
router.get("/checkout/:bookingId", isLoggedIn, wrapAsync(paymentsController.renderCheckout));

// POST /payments/process/:bookingId - Validate billing, snapshot address, create Razorpay Payment Link & redirect
router.post(
	"/process/:bookingId",
	isLoggedIn,
	validateCheckoutPaymentLink,
	wrapAsync(paymentsController.processPayment),
);

// GET /payments/razorpay/callback - Hosted Payment Link callback verification
router.get(
	"/razorpay/callback",
	isLoggedIn,
	validateRazorpayPaymentLinkCallback,
	wrapAsync(paymentsController.handleRazorpayCallback),
);

// POST /payments/verify/:bookingId - Legacy Razorpay order signature verification
router.post(
	"/verify/:bookingId",
	isLoggedIn,
	validateRazorpayVerify,
	wrapAsync(paymentsController.verifyRazorpay),
);

// GET /payments/receipt/:id - Render printable invoice & payment receipt
router.get("/receipt/:id", isLoggedIn, wrapAsync(paymentsController.renderReceipt));

module.exports = router;

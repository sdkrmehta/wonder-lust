const express = require("express");
const router = express.Router();
const wrapAsync = require("../utils/wrapAsync");
const {
	saveRedirectUrl,
	isLoggedIn,
	validateSignup,
	validateVerifyEmailOtp,
	validateResendOtp,
	validateProfileUpdate,
	validatePasswordChange,
} = require("../middleware");
const { handleAvatarUpload } = require("../config/storage");
const {
	authLimiter,
	otpVerifyLimiter,
	otpResendLimiter,
} = require("../config/security");
const userController = require("../controllers/users");

router
	.route("/signup")
	.get(userController.renderSignupForm)
	.post(authLimiter, validateSignup, wrapAsync(userController.signup));

router
	.route("/verify-email")
	.get(wrapAsync(userController.renderVerifyEmailForm))
	.post(otpVerifyLimiter, validateVerifyEmailOtp, wrapAsync(userController.verifyEmailOtp));

router.post(
	"/verify-email/resend",
	otpResendLimiter,
	validateResendOtp,
	wrapAsync(userController.resendVerificationOtp),
);

router
	.route("/login")
	.get(userController.renderLoginForm)
	.post(
		authLimiter,
		saveRedirectUrl,
		userController.authenticateAndLogin,
	);

router.post("/logout", userController.logout);
router.get("/logout", userController.logout);

// User Profile Routes
router.get("/profile", isLoggedIn, wrapAsync(userController.renderProfile));
router.get("/profile/edit", isLoggedIn, wrapAsync(userController.renderEditProfile));

router.put(
	"/profile",
	isLoggedIn,
	handleAvatarUpload,
	validateProfileUpdate,
	wrapAsync(userController.updateProfile),
);

router.post(
	"/profile/change-password",
	authLimiter,
	isLoggedIn,
	validatePasswordChange,
	wrapAsync(userController.changePassword),
);

// Public User Profile Route
router.get("/users/:id", wrapAsync(userController.renderPublicProfile));

module.exports = router;

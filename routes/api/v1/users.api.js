const express = require("express");
const router = express.Router();
const wrapAsync = require("../../../utils/wrapAsync");
const ApiResponse = require("../../../utils/apiResponse");
const UserService = require("../../../services/user.service");
const OtpService = require("../../../services/otp.service");
const {
	isLoggedIn,
	validateSignup,
	validateVerifyEmailOtp,
	validateResendOtp,
	validateProfileUpdate,
	validatePasswordChange,
} = require("../../../middleware");
const { handleAvatarUpload } = require("../../../config/storage");
const {
	authLimiter,
	otpVerifyLimiter,
	otpResendLimiter,
} = require("../../../config/security");
const { generateCsrfToken } = require("../../../middleware/csrf.middleware");

// POST /api/v1/users/signup - Create unverified account and dispatch email OTP
router.post(
	"/signup",
	authLimiter,
	validateSignup,
	wrapAsync(async (req, res) => {
		const { user, verification } = await UserService.registerUser(req.body);
		if (req.session) {
			req.session.pendingVerificationEmail = user.email;
		}
		return ApiResponse.created(
			res,
			{
				email: user.email,
				verificationRequired: true,
				expiresAt: verification.expiresAt,
				cooldownSeconds: verification.cooldownSeconds,
			},
			"Account created. Please verify your email address with the 6-digit OTP sent to your inbox.",
		);
	}),
);

// POST /api/v1/users/verify-email - Verify email OTP and establish authenticated session
router.post(
	"/verify-email",
	otpVerifyLimiter,
	validateVerifyEmailOtp,
	wrapAsync(async (req, res) => {
		const verifiedUser = await OtpService.verifySignupOtp({
			email: req.body.email,
			otp: req.body.otp,
			purpose: "signup_verification",
		});
		await new Promise((resolve, reject) => {
			req.login(verifiedUser, (err) => (err ? reject(err) : resolve()));
		});
		if (req.session) {
			delete req.session.pendingVerificationEmail;
			req.session.csrfToken = generateCsrfToken();
			req.session.userSessionVersion = Number(verifiedUser.sessionVersion || 1);
		}
		return ApiResponse.success(
			res,
			{
				verified: true,
				user: verifiedUser,
			},
			"Email verified successfully",
		);
	}),
);

// POST /api/v1/users/verify-email/resend - Resend verification OTP respecting cooldown & rate limits
router.post(
	"/verify-email/resend",
	otpResendLimiter,
	validateResendOtp,
	wrapAsync(async (req, res) => {
		const result = await OtpService.resendVerificationOtp(req.body.email, {
			purpose: "signup_verification",
		});
		return ApiResponse.success(
			res,
			{
				cooldownSeconds: result.cooldownSeconds,
				expiresAt: result.expiresAt || null,
			},
			result.genericMessage,
		);
	}),
);

// GET /api/v1/users/profile - Current user profile & statistics
router.get(
	"/profile",
	isLoggedIn,
	wrapAsync(async (req, res) => {
		const profileData = await UserService.getUserProfileWithStats(req.user._id, {
			includePrivate: true,
		});
		return ApiResponse.success(res, profileData);
	}),
);

// PUT /api/v1/users/profile - Update profile details
router.put(
	"/profile",
	isLoggedIn,
	handleAvatarUpload,
	validateProfileUpdate,
	wrapAsync(async (req, res) => {
		const updatedUser = await UserService.updateUserProfile(
			req.user._id,
			req.body,
			req.file,
		);
		return ApiResponse.success(res, updatedUser, "Profile updated successfully");
	}),
);

// POST /api/v1/users/change-password - Change account password
router.post(
	"/change-password",
	authLimiter,
	isLoggedIn,
	validatePasswordChange,
	wrapAsync(async (req, res) => {
		const { currentPassword, newPassword } = req.body;
		const updatedUser = await UserService.changePassword(
			req.user._id,
			currentPassword,
			newPassword,
		);
		await new Promise((resolve) => {
			req.login(updatedUser, (err) => {
				if (!err && req.session) {
					req.session.csrfToken = generateCsrfToken();
					req.session.userSessionVersion = Number(updatedUser.sessionVersion || 1);
				}
				resolve();
			});
		});
		return ApiResponse.success(res, null, "Password updated successfully");
	}),
);

module.exports = router;

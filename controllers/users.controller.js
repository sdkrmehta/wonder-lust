const passport = require("passport");
const UserService = require("../services/user.service");
const OtpService = require("../services/otp.service");
const env = require("../config/env");
const { SUPPORTED_COUNTRIES, normalizeEmail } = require("../utils/addressValidation");
const { sanitizeLoginRedirect } = require("../middleware/auth.middleware");
const { generateCsrfToken } = require("../middleware/csrf.middleware");

module.exports.renderSignupForm = (req, res) => {
	res.render("users/signup.ejs", {
		formData: {},
		countries: SUPPORTED_COUNTRIES,
	});
};

module.exports.signup = async (req, res) => {
	try {
		const { user, verification } = await UserService.registerUser(req.body);
		if (req.session) {
			req.session.pendingVerificationEmail = user.email;
		}
		req.flash(
			"success",
			`We sent a 6-digit verification code to ${user.email}. Please verify your email to activate your account.`,
		);
		return res.redirect("/verify-email");
	} catch (e) {
		req.flash("error", e.message);
		return res.redirect("/signup");
	}
};

module.exports.renderVerifyEmailForm = async (req, res) => {
	if (req.isAuthenticated && req.isAuthenticated() && req.user?.emailVerified !== false) {
		return res.redirect("/listings");
	}
	const rawEmail =
		(typeof req.query?.email === "string" && req.query.email.trim()) ||
		(req.session && req.session.pendingVerificationEmail) ||
		"";
	const cleanEmail = normalizeEmail(rawEmail);
	const status = cleanEmail
		? await OtpService.getResendCooldownStatus(cleanEmail, "signup_verification")
		: { cooldownSecondsRemaining: 0 };

	return res.render("users/verify-email.ejs", {
		email: cleanEmail,
		cooldownSeconds: status.cooldownSecondsRemaining,
		ttlMinutes: Math.max(1, Math.round(env.OTP_TTL_SECONDS / 60)),
	});
};

module.exports.verifyEmailOtp = async (req, res, next) => {
	const cleanEmail = normalizeEmail(req.body?.email || req.session?.pendingVerificationEmail || "");
	try {
		const verifiedUser = await OtpService.verifySignupOtp({
			email: cleanEmail,
			otp: req.body?.otp,
			purpose: "signup_verification",
		});

		return req.login(verifiedUser, (err) => {
			if (err) {
				return next(err);
			}
			if (req.session) {
				delete req.session.pendingVerificationEmail;
				req.session.csrfToken = generateCsrfToken();
				req.session.userSessionVersion = Number(verifiedUser.sessionVersion || 1);
			}
			const redirectUrl = sanitizeLoginRedirect(req.session?.redirectUrl, "/listings");
			if (req.session && req.session.redirectUrl) {
				delete req.session.redirectUrl;
			}
			req.flash("success", "Email verified! Welcome to Wonder-Lust.");
			return res.redirect(redirectUrl);
		});
	} catch (err) {
		if (req.session && cleanEmail) {
			req.session.pendingVerificationEmail = cleanEmail;
		}
		const status = cleanEmail
			? await OtpService.getResendCooldownStatus(cleanEmail, "signup_verification").catch(() => ({
					cooldownSecondsRemaining: 0,
				}))
			: { cooldownSecondsRemaining: 0 };
		return res.status(err.statusCode || 400).render("users/verify-email.ejs", {
			email: cleanEmail,
			cooldownSeconds: status.cooldownSecondsRemaining || 0,
			ttlMinutes: Math.max(1, Math.round(env.OTP_TTL_SECONDS / 60)),
			error: [err.message || "Unable to verify email code."],
		});
	}
};

module.exports.resendVerificationOtp = async (req, res) => {
	const cleanEmail = normalizeEmail(req.body?.email || req.session?.pendingVerificationEmail || "");
	if (req.session && cleanEmail) {
		req.session.pendingVerificationEmail = cleanEmail;
	}
	try {
		const result = await OtpService.resendVerificationOtp(cleanEmail, {
			purpose: "signup_verification",
		});
		req.flash("success", result.genericMessage);
		return res.redirect("/verify-email");
	} catch (err) {
		const status = cleanEmail
			? await OtpService.getResendCooldownStatus(cleanEmail, "signup_verification").catch(() => ({
					cooldownSecondsRemaining: 0,
				}))
			: { cooldownSecondsRemaining: 0 };
		return res.status(err.statusCode || 429).render("users/verify-email.ejs", {
			email: cleanEmail,
			cooldownSeconds: status.cooldownSecondsRemaining || 0,
			ttlMinutes: Math.max(1, Math.round(env.OTP_TTL_SECONDS / 60)),
			error: [err.message || "Unable to resend verification code."],
		});
	}
};

module.exports.renderLoginForm = (req, res) => {
	res.render("users/login.ejs");
};

module.exports.authenticateAndLogin = (req, res, next) => {
	passport.authenticate("local", (err, user, info) => {
		if (err) {
			return next(err);
		}
		if (!user) {
			if (info && info.name === "EmailNotVerifiedError") {
				if (req.session && info.email) {
					req.session.pendingVerificationEmail = info.email;
				}
				req.flash(
					"error",
					info.message || "Please verify your email address before signing in.",
				);
				return res.redirect("/verify-email");
			}
			req.flash(
				"error",
				(info && info.message) || "Invalid email/username or password.",
			);
			return res.redirect("/login");
		}
		return req.login(user, (loginErr) => {
			if (loginErr) {
				return next(loginErr);
			}
			if (req.session) {
				req.session.csrfToken = generateCsrfToken();
				req.session.userSessionVersion = Number(user.sessionVersion || 1);
			}
			req.flash("success", "Welcome back to Wonder-Lust!");
			const redirectUrl = sanitizeLoginRedirect(res.locals.redirectUrl, "/listings");
			if (req.session && req.session.redirectUrl) {
				delete req.session.redirectUrl;
			}
			return res.redirect(redirectUrl);
		});
	})(req, res, next);
};

module.exports.login = async (req, res) => {
	if (req.session) {
		req.session.csrfToken = generateCsrfToken();
		req.session.userSessionVersion = Number((req.user && req.user.sessionVersion) || 1);
	}
	req.flash("success", "Welcome back to Wonder-Lust!");
	const redirectUrl = sanitizeLoginRedirect(res.locals.redirectUrl, "/listings");
	if (req.session && req.session.redirectUrl) {
		delete req.session.redirectUrl;
	}
	res.redirect(redirectUrl);
};

module.exports.logout = (req, res, next) => {
	req.logout((err) => {
		if (err) {
			return next(err);
		}
		if (req.session && typeof req.session.regenerate === "function") {
			return req.session.regenerate((regenErr) => {
				if (regenErr) {
					return res.redirect("/listings");
				}
				req.session.csrfToken = generateCsrfToken();
				req.flash("success", "You have successfully logged out!");
				return res.redirect("/listings");
			});
		}
		req.flash("success", "You have successfully logged out!");
		return res.redirect("/listings");
	});
};

module.exports.renderProfile = async (req, res) => {
	try {
		const profileData = await UserService.getUserProfileWithStats(req.user._id, {
			includePrivate: true,
		});
		res.render("users/profile.ejs", {
			profileUser: profileData.user,
			stats: profileData.stats,
			recentTrips: profileData.recentTrips,
			userListings: profileData.userListings,
			isOwner: true,
		});
	} catch (err) {
		req.flash("error", err.message || "Unable to load profile.");
		res.redirect("/listings");
	}
};

module.exports.renderPublicProfile = async (req, res) => {
	try {
		const isOwner = Boolean(req.user && String(req.user._id) === String(req.params.id));
		const profileData = await UserService.getUserProfileWithStats(req.params.id, {
			includePrivate: isOwner,
		});
		res.render("users/profile.ejs", {
			profileUser: profileData.user,
			stats: profileData.stats,
			recentTrips: isOwner ? profileData.recentTrips : [],
			userListings: profileData.userListings,
			isOwner,
		});
	} catch (err) {
		req.flash("error", err.message || "User profile not found.");
		res.redirect("/listings");
	}
};

module.exports.renderEditProfile = async (req, res) => {
	const freshUser = (await UserService.getUserById(req.user._id)) || req.user;
	res.render("users/edit.ejs", {
		user: freshUser,
		countries: SUPPORTED_COUNTRIES,
	});
};

module.exports.updateProfile = async (req, res) => {
	try {
		await UserService.updateUserProfile(req.user._id, req.body, req.file);
		req.flash("success", "Profile updated successfully!");
		res.redirect("/profile");
	} catch (err) {
		req.flash("error", err.message || "Failed to update profile.");
		res.redirect("/profile/edit");
	}
};

module.exports.changePassword = async (req, res) => {
	try {
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
		req.flash("success", "Password updated successfully!");
		res.redirect("/profile");
	} catch (err) {
		req.flash("error", err.message || "Failed to update password.");
		res.redirect("/profile/edit");
	}
};

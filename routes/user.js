const express = require("express");
const router = express.Router();
const wrapAsync = require("../utils/wrapAsync");
const passport = require("passport");
const {
	saveRedirectUrl,
	isLoggedIn,
	validateProfileUpdate,
	validatePasswordChange,
} = require("../middleware");
const { handleAvatarUpload } = require("../config/storage");
const { authLimiter } = require("../config/security");
const userController = require("../controllers/users");

router
	.route("/signup")
	.get(userController.renderSignupForm)
	.post(authLimiter, wrapAsync(userController.signup));

router
	.route("/login")
	.get(userController.renderLoginForm)
	.post(
		authLimiter,
		saveRedirectUrl,
		passport.authenticate("local", {
			failureRedirect: "/login",
			failureFlash: true,
		}),
		userController.login,
	);

router.get("/logout", userController.logout);

// User Profile Routes
router.get("/profile", isLoggedIn, wrapAsync(userController.renderProfile));
router.get("/profile/edit", isLoggedIn, userController.renderEditProfile);

router.put(
	"/profile",
	isLoggedIn,
	handleAvatarUpload,
	validateProfileUpdate,
	wrapAsync(userController.updateProfile),
);

router.post(
	"/profile/change-password",
	isLoggedIn,
	validatePasswordChange,
	wrapAsync(userController.changePassword),
);

// Public User Profile Route
router.get("/users/:id", wrapAsync(userController.renderPublicProfile));

module.exports = router;

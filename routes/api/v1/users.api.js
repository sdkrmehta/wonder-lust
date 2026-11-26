const express = require("express");
const router = express.Router();
const wrapAsync = require("../../../utils/wrapAsync");
const ApiResponse = require("../../../utils/apiResponse");
const UserService = require("../../../services/user.service");
const {
	isLoggedIn,
	validateProfileUpdate,
	validatePasswordChange,
} = require("../../../middleware");
const { handleAvatarUpload } = require("../../../config/storage");
const { authLimiter } = require("../../../config/security");
const { generateCsrfToken } = require("../../../middleware/csrf.middleware");

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

const UserService = require("../services/user.service");
const { sanitizeInternalRedirect } = require("../middleware/auth.middleware");
const { generateCsrfToken } = require("../middleware/csrf.middleware");

module.exports.renderSignupForm = (req, res) => {
	res.render("users/signup.ejs");
};

module.exports.signup = async (req, res, next) => {
	try {
		const { username, email, password } = req.body;
		const registeredUser = await UserService.registerUser({
			username,
			email,
			password,
		});

		req.login(registeredUser, (err) => {
			if (err) {
				return next(err);
			}
			if (req.session) {
				req.session.csrfToken = generateCsrfToken();
				req.session.userSessionVersion = Number(registeredUser.sessionVersion || 1);
			}
			req.flash(
				"success",
				"Welcome to Wander-Lust! Your account has been created.",
			);
			res.redirect("/listings");
		});
	} catch (e) {
		req.flash("error", e.message);
		res.redirect("/signup");
	}
};

module.exports.renderLoginForm = (req, res) => {
	res.render("users/login.ejs");
};

module.exports.login = async (req, res) => {
	if (req.session) {
		req.session.csrfToken = generateCsrfToken();
		req.session.userSessionVersion = Number((req.user && req.user.sessionVersion) || 1);
	}
	req.flash("success", "Welcome back to Wander-Lust!");
	const redirectUrl = sanitizeInternalRedirect(res.locals.redirectUrl, "/listings");
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

module.exports.renderEditProfile = (req, res) => {
	res.render("users/edit.ejs", { user: req.user });
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

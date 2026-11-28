const crypto = require("crypto");
const User = require("../models/user");
const Booking = require("../models/booking");
const Review = require("../models/review");
const Listing = require("../models/listing");
const AppError = require("../utils/AppError");
const OtpService = require("./otp.service");
const { persistUploadedFile, deleteStoredAsset } = require("../config/storage");
const {
	validatePostalCodeForCountry,
	normalizeEmail,
	extractAddressSnapshot,
	formatAddressSummary,
} = require("../utils/addressValidation");

class UserService {
	static async _generateUniqueUsername(fullName, email) {
		const rawBase = (fullName || (email ? email.split("@")[0] : "") || "traveler")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "_")
			.replace(/^_+|_+$/g, "")
			.slice(0, 24);
		const safeBase = rawBase.length >= 3 ? rawBase : `traveler_${rawBase || "wl"}`;

		for (let i = 0; i < 6; i++) {
			const suffix = i === 0 ? "" : `_${crypto.randomBytes(2).toString("hex")}`;
			const candidate = `${safeBase}${suffix}`.slice(0, 40);
			const exists = await User.exists({ username: candidate });
			if (!exists) {
				return candidate;
			}
		}
		return `traveler_${Date.now().toString(36)}_${crypto.randomBytes(2).toString("hex")}`;
	}

	/**
	 * Register a new unverified customer account with full profile & address details,
	 * then dispatch a 6-digit email OTP via Resend.
	 */
	static async registerUser(payload = {}) {
		const {
			fullName,
			username,
			email,
			password,
			confirmPassword,
			phone = "",
			addressLine1,
			addressLine2 = "",
			landmark = "",
			city,
			state,
			postalCode,
			country = "India",
			termsAccepted,
		} = payload;

		const cleanEmail = normalizeEmail(email);
		const cleanFullName = typeof fullName === "string" ? fullName.trim() : "";

		if (!cleanFullName || !cleanEmail || typeof password !== "string" || !password) {
			throw AppError.badRequest("Full name, email, and password are required");
		}
		if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
			throw AppError.badRequest("Please provide a valid email address");
		}
		if (password.length < 8 || password.length > 128 || !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/.test(password)) {
			throw AppError.badRequest(
				"Password must be at least 8 characters and include uppercase, lowercase, and a number",
			);
		}
		if (confirmPassword !== undefined && password !== confirmPassword) {
			throw AppError.badRequest("Password and confirm password do not match");
		}
		if (!termsAccepted) {
			throw AppError.badRequest("You must accept the Terms of Service and Privacy Policy");
		}

		const addressSnapshot = extractAddressSnapshot({
			addressLine1,
			addressLine2,
			landmark,
			city,
			state,
			postalCode,
			country,
		});
		if (!addressSnapshot.addressLine1 || !addressSnapshot.city || !addressSnapshot.state) {
			throw AppError.badRequest("Complete street address, city, and state are required");
		}
		const postalCheck = validatePostalCodeForCountry(
			addressSnapshot.postalCode,
			addressSnapshot.country,
		);
		if (!postalCheck.valid) {
			throw AppError.badRequest(postalCheck.message);
		}
		addressSnapshot.postalCode = postalCheck.value;

		const existingEmail = await User.findOne({ email: cleanEmail });
		if (existingEmail) {
			// Generic message prevents account enumeration while blocking duplicate registration
			throw AppError.badRequest(
				"Unable to complete registration with these details. If you already have an account, please sign in or verify your email.",
			);
		}

		let cleanUsername = typeof username === "string" ? username.trim() : "";
		if (cleanUsername) {
			if (cleanUsername.length < 3 || cleanUsername.length > 50) {
				throw AppError.badRequest("Username must be between 3 and 50 characters");
			}
			const existingUsername = await User.exists({ username: cleanUsername });
			if (existingUsername) {
				throw AppError.badRequest(
					"Unable to complete registration with these details. Please try a different username or sign in.",
				);
			}
		} else {
			cleanUsername = await this._generateUniqueUsername(cleanFullName, cleanEmail);
		}

		const newUser = new User({
			email: cleanEmail,
			username: cleanUsername,
			fullName: cleanFullName,
			phone: typeof phone === "string" ? phone.trim() : "",
			...addressSnapshot,
			emailVerified: false,
			emailVerifiedAt: null,
			termsAcceptedAt: new Date(),
		});

		const registeredUser = await User.register(newUser, password);

		try {
			const otpMeta = await OtpService.issueVerificationOtp(registeredUser, {
				purpose: "signup_verification",
				enforceCooldown: false,
			});
			return {
				user: registeredUser,
				verification: otpMeta,
			};
		} catch (otpErr) {
			// Roll back newly created unverified account if initial OTP delivery fails
			await User.deleteOne({ _id: registeredUser._id }).catch(() => {});
			throw otpErr;
		}
	}

	/**
	 * Find user by ID.
	 */
	static async getUserById(id) {
		return await User.findById(id);
	}

	/**
	 * Retrieve user profile with activity metrics and history.
	 * Restricts private booking history, contact details, and draft listings when viewed publicly.
	 */
	static async getUserProfileWithStats(userId, options = {}) {
		const includePrivate = options.includePrivate !== false;
		const userQuery = User.findById(userId);
		const user = includePrivate
			? await userQuery.select("-hash -salt -attempts -last")
			: await userQuery.select("username fullName avatar bio city country role isSuperhost createdAt");

		if (!user) {
			throw AppError.notFound("User not found");
		}

		const listingFilter = includePrivate
			? { owner: userId }
			: { owner: userId, status: "published" };

		const [tripsCount, reviewsCount, listingsCount, recentTrips, userListings] =
			await Promise.all([
				includePrivate ? Booking.countDocuments({ user: userId }) : Promise.resolve(0),
				Review.countDocuments({ author: userId }),
				Listing.countDocuments(listingFilter),
				includePrivate
					? Booking.find({ user: userId })
							.populate("listing", "title location country image images")
							.sort({ checkIn: -1 })
							.limit(5)
							.lean()
					: Promise.resolve([]),
				Listing.find(listingFilter)
					.select("title price location country image avgRating views status")
					.sort({ createdAt: -1 })
					.limit(6)
					.lean(),
			]);

		return {
			user,
			stats: {
				tripsCount,
				reviewsCount,
				listingsCount,
				isHost: listingsCount > 0,
			},
			recentTrips,
			userListings,
		};
	}

	/**
	 * Update user profile details, saved address, and avatar image.
	 * Never allows changing login email without dedicated verification.
	 */
	static async updateUserProfile(userId, profileData = {}, avatarFile = null) {
		const user = await User.findById(userId);
		if (!user) {
			throw AppError.notFound("User not found");
		}

		const data =
			profileData && typeof profileData.user === "object" && profileData.user !== null
				? profileData.user
				: profileData || {};

		if ("email" in data || "emailVerified" in data || "emailVerifiedAt" in data) {
			throw AppError.badRequest(
				"Login email cannot be changed directly without a separate email verification flow",
			);
		}

		if (typeof data.fullName === "string") {
			const cleanName = data.fullName.trim();
			if (cleanName.length < 2) {
				throw AppError.badRequest("Full name must be at least 2 characters long");
			}
			user.fullName = cleanName;
		}
		if (typeof data.bio === "string") user.bio = data.bio.trim();
		if (typeof data.phone === "string") user.phone = data.phone.trim();

		const nextCountry =
			typeof data.country === "string" && data.country.trim()
				? data.country.trim()
				: user.country || "India";

		const touchesStructuredAddress =
			"addressLine1" in data ||
			"addressLine2" in data ||
			"landmark" in data ||
			"state" in data ||
			"postalCode" in data;

		if (typeof data.addressLine1 === "string") user.addressLine1 = data.addressLine1.trim();
		if (typeof data.addressLine2 === "string") user.addressLine2 = data.addressLine2.trim();
		if (typeof data.landmark === "string") user.landmark = data.landmark.trim();
		if (typeof data.city === "string") user.city = data.city.trim();
		if (typeof data.state === "string") user.state = data.state.trim();
		if (typeof data.country === "string" && data.country.trim()) {
			user.country = data.country.trim();
		}
		if (typeof data.postalCode === "string") {
			const cleanPostal = data.postalCode.trim();
			if (cleanPostal) {
				const check = validatePostalCodeForCountry(cleanPostal, nextCountry);
				if (!check.valid) {
					throw AppError.badRequest(check.message);
				}
				user.postalCode = check.value;
			} else if (touchesStructuredAddress && (user.postalCode || "postalCode" in data)) {
				throw AppError.badRequest("PIN / Postal code is required");
			}
		}

		if (touchesStructuredAddress) {
			if (user.addressLine1 && user.addressLine1.length < 3) {
				throw AppError.badRequest("Address Line 1 must be at least 3 characters long");
			}
			user.address =
				formatAddressSummary({
					addressLine1: user.addressLine1,
					addressLine2: user.addressLine2,
					landmark: user.landmark,
				}) || user.address;
		} else if (typeof data.address === "string") {
			user.address = data.address.trim();
			if (!user.addressLine1 && user.address) {
				user.addressLine1 = user.address;
			}
		}

		// Handle avatar upload
		if (avatarFile) {
			const storedAvatar = await persistUploadedFile(avatarFile, { folder: "wonderlust/avatars" });
			if (user.avatar && user.avatar.filename) {
				await deleteStoredAsset(user.avatar);
			}
			user.avatar = {
				url: storedAvatar.url,
				filename: storedAvatar.filename,
			};
		}

		await user.save();
		return user;
	}

	/**
	 * Change user account password securely.
	 */
	static async changePassword(userId, currentPassword, newPassword) {
		const user = await User.findById(userId);
		if (!user) {
			throw AppError.notFound("User not found");
		}

		return new Promise((resolve, reject) => {
			user.changePassword(currentPassword, newPassword, async (err, updatedUser) => {
				if (err) {
					return reject(AppError.badRequest(err.message || "Failed to update password"));
				}
				try {
					updatedUser.sessionVersion = Number(updatedUser.sessionVersion || 1) + 1;
					await updatedUser.save();
					resolve(updatedUser);
				} catch (saveErr) {
					reject(saveErr);
				}
			});
		});
	}
}

module.exports = UserService;

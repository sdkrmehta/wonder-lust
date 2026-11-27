const User = require("../models/user");
const Booking = require("../models/booking");
const Review = require("../models/review");
const Listing = require("../models/listing");
const AppError = require("../utils/AppError");
const { persistUploadedFile, deleteStoredAsset } = require("../config/storage");

class UserService {
	/**
	 * Register a new user account with duplicate email and username validation.
	 */
	static async registerUser({ username, email, password }) {
		if (
			typeof username !== "string" ||
			typeof email !== "string" ||
			typeof password !== "string" ||
			!username.trim() ||
			!email.trim() ||
			!password
		) {
			throw AppError.badRequest("Username, email, and password are required");
		}

		const cleanUsername = username.trim();
		const cleanEmail = email.trim().toLowerCase();

		if (cleanUsername.length < 3 || cleanUsername.length > 50) {
			throw AppError.badRequest("Username must be between 3 and 50 characters");
		}
		if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
			throw AppError.badRequest("Please provide a valid email address");
		}
		if (password.length < 6 || password.length > 128) {
			throw AppError.badRequest("Password must be between 6 and 128 characters");
		}

		const existingEmail = await User.findOne({ email: cleanEmail });
		if (existingEmail) {
			throw AppError.badRequest("An account with that email address already exists");
		}

		const newUser = new User({ email: cleanEmail, username: cleanUsername });
		return await User.register(newUser, password);
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
	 * Update user profile details and avatar image.
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

		if (typeof data.fullName === "string") user.fullName = data.fullName.trim();
		if (typeof data.bio === "string") user.bio = data.bio.trim();
		if (typeof data.phone === "string") user.phone = data.phone.trim();
		if (typeof data.address === "string") user.address = data.address.trim();
		if (typeof data.city === "string") user.city = data.city.trim();
		if (typeof data.country === "string") user.country = data.country.trim();

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

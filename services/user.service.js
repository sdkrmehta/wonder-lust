const User = require("../models/user");
const Booking = require("../models/booking");
const Review = require("../models/review");
const Listing = require("../models/listing");
const AppError = require("../utils/AppError");
const { cleanupLocalFile } = require("../config/storage");

class UserService {
	/**
	 * Register a new user account with duplicate email and username validation.
	 */
	static async registerUser({ username, email, password }) {
		if (!username || !email || !password) {
			throw AppError.badRequest("Username, email, and password are required");
		}

		const cleanUsername = username.trim();
		const cleanEmail = email.trim().toLowerCase();

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
	 * Retrieve comprehensive user profile with activity metrics and history.
	 */
	static async getUserProfileWithStats(userId) {
		const user = await User.findById(userId);
		if (!user) {
			throw AppError.notFound("User not found");
		}

		const [tripsCount, reviewsCount, listingsCount, recentTrips, userListings] =
			await Promise.all([
				Booking.countDocuments({ user: userId }),
				Review.countDocuments({ author: userId }),
				Listing.countDocuments({ owner: userId }),
				Booking.find({ user: userId })
					.populate("listing", "title location country image images")
					.sort({ checkIn: -1 })
					.limit(5)
					.lean(),
				Listing.find({ owner: userId })
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

		const data = profileData.user || profileData;

		if (data.fullName !== undefined) user.fullName = data.fullName.trim();
		if (data.bio !== undefined) user.bio = data.bio.trim();
		if (data.phone !== undefined) user.phone = data.phone.trim();
		if (data.address !== undefined) user.address = data.address.trim();
		if (data.city !== undefined) user.city = data.city.trim();
		if (data.country !== undefined) user.country = data.country.trim();

		// Handle avatar upload
		if (avatarFile) {
			// Remove old avatar if exists
			if (user.avatar && user.avatar.filename) {
				cleanupLocalFile(user.avatar.filename);
			}
			user.avatar = {
				url: `/uploads/${avatarFile.filename}`,
				filename: avatarFile.filename,
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
			user.changePassword(currentPassword, newPassword, (err, updatedUser) => {
				if (err) {
					return reject(AppError.badRequest(err.message || "Failed to update password"));
				}
				resolve(updatedUser);
			});
		});
	}
}

module.exports = UserService;

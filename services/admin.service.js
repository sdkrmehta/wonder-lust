const mongoose = require("mongoose");
const User = require("../models/user");
const Listing = require("../models/listing");
const Booking = require("../models/booking");
const Payment = require("../models/payment");
const Review = require("../models/review");
const ListingService = require("./listing.service");
const ReviewService = require("./review.service");
const AppError = require("../utils/AppError");

class AdminService {
	/**
	 * Compute holistic platform KPIs, user distributions, and financial metrics.
	 */
	static async getPlatformMetrics() {
		const [
			totalUsers,
			hostsCount,
			travelersCount,
			adminsCount,
			totalListings,
			publishedListings,
			draftListings,
			totalBookings,
			confirmedBookings,
			cancelledBookings,
			totalReviews,
			flaggedReviewsCount,
			recentUsers,
			recentBookings,
			succeededPayments,
			refundedPayments,
		] = await Promise.all([
			User.countDocuments(),
			User.countDocuments({ role: "host" }),
			User.countDocuments({ role: "traveler" }),
			User.countDocuments({ role: "admin" }),
			Listing.countDocuments(),
			Listing.countDocuments({ status: { $ne: "draft" } }),
			Listing.countDocuments({ status: "draft" }),
			Booking.countDocuments(),
			Booking.countDocuments({ status: "confirmed" }),
			Booking.countDocuments({ status: "cancelled" }),
			Review.countDocuments(),
			Review.countDocuments({ isFlagged: true }),
			User.find().sort({ createdAt: -1 }).limit(5).select("username email role createdAt isSuperhost").lean(),
			Booking.find()
				.sort({ createdAt: -1 })
				.limit(5)
				.populate("listing", "title location")
				.populate("user", "username email")
				.lean(),
			Payment.find({ status: "succeeded" }).select("amount").lean(),
			Payment.find({ status: "refunded" }).select("refundAmount amount").lean(),
		]);

		const grossBookingValue = succeededPayments.reduce((acc, p) => acc + (p.amount || 0), 0);
		const totalRefunded = refundedPayments.reduce(
			(acc, p) => acc + (p.refundAmount || p.amount || 0),
			0,
		);
		const estimatedPlatformFees = Math.round(grossBookingValue * 0.12); // 12% average take-rate

		return {
			users: {
				total: totalUsers,
				hosts: hostsCount,
				travelers: travelersCount,
				admins: adminsCount,
				recent: recentUsers,
			},
			listings: {
				total: totalListings,
				published: publishedListings,
				draft: draftListings,
			},
			bookings: {
				total: totalBookings,
				confirmed: confirmedBookings,
				cancelled: cancelledBookings,
				recent: recentBookings,
			},
			financials: {
				grossBookingValue,
				estimatedPlatformFees,
				totalRefunded,
			},
			moderation: {
				totalReviews,
				flaggedReviewsCount,
			},
		};
	}

	/**
	 * Retrieve all reviews flagged for content moderation with parent listing info.
	 */
	static async getFlaggedReviews() {
		const flaggedReviews = await Review.find({ isFlagged: true })
			.populate("author", "username email avatar fullName")
			.sort({ createdAt: -1 })
			.lean();

		const enrichedReviews = await Promise.all(
			flaggedReviews.map(async (review) => {
				const listing = await Listing.findOne({ reviews: review._id })
					.select("title location country image price")
					.lean();
				return {
					...review,
					listing: listing || null,
				};
			}),
		);

		return enrichedReviews;
	}

	/**
	 * Dismiss a flag on a review, approving it to remain visible.
	 */
	static async dismissReviewFlag(reviewId) {
		if (!mongoose.Types.ObjectId.isValid(reviewId)) {
			throw AppError.notFound("Invalid review ID");
		}

		const review = await Review.findById(reviewId);
		if (!review) {
			throw AppError.notFound("Review not found");
		}

		review.isFlagged = false;
		review.flagReason = undefined;
		await review.save();

		return review;
	}

	/**
	 * Remove a review permanently and recalculate parent listing ratings.
	 */
	static async deleteReview(reviewId) {
		if (!mongoose.Types.ObjectId.isValid(reviewId)) {
			throw AppError.notFound("Invalid review ID");
		}

		const listing = await Listing.findOne({ reviews: reviewId });
		if (!listing) {
			const deleted = await Review.findByIdAndDelete(reviewId);
			if (!deleted) throw AppError.notFound("Review not found");
			return deleted;
		}

		return await ReviewService.deleteReview(listing._id, reviewId);
	}

	/**
	 * Retrieve paginated platform users with search and role filter.
	 */
	static async getUsers({ search = "", role = "", page = 1, limit = 20 } = {}) {
		const parsedPage = Math.max(1, parseInt(page, 10) || 1);
		const parsedLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
		const skip = (parsedPage - 1) * parsedLimit;

		const query = {};
		if (role && ["traveler", "host", "admin"].includes(role)) {
			query.role = role;
		}

		if (search && search.trim()) {
			const regex = new RegExp(search.trim(), "i");
			query.$or = [{ username: regex }, { email: regex }, { fullName: regex }];
		}

		const [users, total] = await Promise.all([
			User.find(query)
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(parsedLimit)
				.select("-hash -salt")
				.lean(),
			User.countDocuments(query),
		]);

		return {
			users,
			total,
			page: parsedPage,
			totalPages: Math.ceil(total / parsedLimit) || 1,
		};
	}

	/**
	 * Update user role.
	 */
	static async updateUserRole(userId, newRole) {
		if (!mongoose.Types.ObjectId.isValid(userId)) {
			throw AppError.notFound("Invalid user ID");
		}

		if (!["traveler", "host", "admin"].includes(newRole)) {
			throw AppError.badRequest("Invalid role specified");
		}

		const user = await User.findByIdAndUpdate(
			userId,
			{ role: newRole },
			{ new: true, runValidators: true },
		).select("-hash -salt");

		if (!user) {
			throw AppError.notFound("User not found");
		}

		return user;
	}

	/**
	 * Toggle Superhost status for a host account.
	 */
	static async toggleSuperhost(userId) {
		if (!mongoose.Types.ObjectId.isValid(userId)) {
			throw AppError.notFound("Invalid user ID");
		}

		const user = await User.findById(userId);
		if (!user) {
			throw AppError.notFound("User not found");
		}

		user.isSuperhost = !user.isSuperhost;
		await user.save();

		return user;
	}

	/**
	 * Retrieve paginated listings with admin overview metadata.
	 */
	static async getListings({ search = "", status = "", page = 1, limit = 20 } = {}) {
		const parsedPage = Math.max(1, parseInt(page, 10) || 1);
		const parsedLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
		const skip = (parsedPage - 1) * parsedLimit;

		const query = {};
		if (status === "draft") {
			query.status = "draft";
		} else if (status === "published") {
			query.status = { $ne: "draft" };
		}

		if (search && search.trim()) {
			const regex = new RegExp(search.trim(), "i");
			query.$or = [{ title: regex }, { location: regex }, { country: regex }];
		}

		const [listings, total] = await Promise.all([
			Listing.find(query)
				.populate("owner", "username email isSuperhost")
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(parsedLimit)
				.lean(),
			Listing.countDocuments(query),
		]);

		return {
			listings,
			total,
			page: parsedPage,
			totalPages: Math.ceil(total / parsedLimit) || 1,
		};
	}

	/**
	 * Toggle listing publishing status (draft vs published).
	 */
	static async toggleListingStatus(listingId) {
		if (!mongoose.Types.ObjectId.isValid(listingId)) {
			throw AppError.notFound("Invalid listing ID");
		}

		const listing = await Listing.findById(listingId);
		if (!listing) {
			throw AppError.notFound("Listing not found");
		}

		listing.status =
			listing.status === "draft" ? "published" : "draft";
		await listing.save();

		return listing;
	}

	/**
	 * Delete a listing as admin.
	 */
	static async deleteListing(listingId) {
		return await ListingService.deleteListing(listingId);
	}
}

module.exports = AdminService;

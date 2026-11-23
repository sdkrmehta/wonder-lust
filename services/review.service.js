const mongoose = require("mongoose");
const Listing = require("../models/listing");
const Review = require("../models/review");
const Booking = require("../models/booking");
const AppError = require("../utils/AppError");

class ReviewService {
	/**
	 * Create a review and associate it to a listing with verified stay detection.
	 */
	static async createReview(
		listingId,
		reviewData,
		user,
		{ preventHostReview = false } = {},
	) {
		if (!mongoose.Types.ObjectId.isValid(listingId)) {
			throw AppError.notFound("Invalid listing ID");
		}

		const listing = await Listing.findById(listingId);
		if (!listing) {
			throw AppError.notFound("Listing not found");
		}

		// Prevent host from reviewing their own property when enforced
		if (
			preventHostReview &&
			listing.owner &&
			String(listing.owner) === String(user._id)
		) {
			throw AppError.badRequest("Hosts cannot review their own properties");
		}

		// Check if user has an active or completed booking on this property
		const verifiedBooking = await Booking.findOne({
			listing: listingId,
			user: user._id,
			status: { $in: ["confirmed", "completed"] },
		});

		const newReview = new Review({
			...reviewData,
			author: user._id,
			isVerifiedStay: Boolean(verifiedBooking),
		});

		listing.reviews.push(newReview);

		await newReview.save();
		await listing.save();
		await this.updateListingRating(listingId);

		// Notify listing owner of new review
		try {
			const NotificationService = require("./notification.service");
			if (listing.owner) {
				const previewComment =
					newReview.comment && newReview.comment.length > 60
						? newReview.comment.substring(0, 57) + "..."
						: newReview.comment || "left a review";
				await NotificationService.createNotification({
					recipient: listing.owner,
					sender: user._id,
					type: "new_review",
					title: `New ${newReview.rating}★ Review for ${listing.title}`,
					message: `${user.username || "A traveler"} rated your place ${newReview.rating}/5: "${previewComment}"`,
					link: `/listings/${listing._id}`,
					metadata: {
						reviewId: newReview._id,
						listingId: listing._id,
						rating: newReview.rating,
					},
				});
			}
		} catch (err) {
			console.error("[Notification Error - Review Created]:", err.message);
		}

		return await Review.findById(newReview._id).populate("author", "username avatar fullName");
	}

	/**
	 * Delete a review and remove reference from listing.
	 */
	static async deleteReview(listingId, reviewId) {
		if (
			!mongoose.Types.ObjectId.isValid(listingId) ||
			!mongoose.Types.ObjectId.isValid(reviewId)
		) {
			throw AppError.notFound("Invalid listing or review ID");
		}

		await Listing.findByIdAndUpdate(listingId, {
			$pull: { reviews: reviewId },
		});
		const deletedReview = await Review.findByIdAndDelete(reviewId);

		if (!deletedReview) {
			throw AppError.notFound("Review does not exist");
		}

		await this.updateListingRating(listingId);

		return deletedReview;
	}

	/**
	 * Add an official host response/reply to a guest review.
	 */
	static async addHostReply(listingId, reviewId, replyComment, hostUser) {
		if (
			!mongoose.Types.ObjectId.isValid(listingId) ||
			!mongoose.Types.ObjectId.isValid(reviewId)
		) {
			throw AppError.notFound("Invalid listing or review ID");
		}

		const listing = await Listing.findById(listingId);
		if (!listing) {
			throw AppError.notFound("Listing not found");
		}

		// Verify that user is the owner of the listing
		if (String(listing.owner) !== String(hostUser._id)) {
			throw AppError.forbidden("Only the property host can reply to guest reviews");
		}

		const review = await Review.findById(reviewId);
		if (!review) {
			throw AppError.notFound("Review not found");
		}

		review.hostReply = {
			comment: replyComment.trim(),
			repliedAt: new Date(),
			author: hostUser._id,
		};

		await review.save();

		// Notify review author of host reply
		try {
			const NotificationService = require("./notification.service");
			if (review.author) {
				const previewReply =
					replyComment && replyComment.length > 60
						? replyComment.substring(0, 57) + "..."
						: replyComment;
				await NotificationService.createNotification({
					recipient: review.author,
					sender: hostUser._id,
					type: "host_reply",
					title: `Host Replied to Your Review on ${listing.title}`,
					message: `${hostUser.username || "The host"} responded: "${previewReply}"`,
					link: `/listings/${listing._id}`,
					metadata: {
						reviewId: review._id,
						listingId: listing._id,
					},
				});
			}
		} catch (err) {
			console.error("[Notification Error - Host Reply]:", err.message);
		}

		return review;
	}

	/**
	 * Toggle a helpfulness vote on a review.
	 */
	static async toggleHelpfulVote(reviewId, user) {
		if (!mongoose.Types.ObjectId.isValid(reviewId)) {
			throw AppError.notFound("Invalid review ID");
		}

		const review = await Review.findById(reviewId);
		if (!review) {
			throw AppError.notFound("Review not found");
		}

		const userIdStr = String(user._id);
		const existingVoteIndex = review.helpfulVotes.findIndex(
			(id) => String(id) === userIdStr,
		);

		let hasVoted = false;
		if (existingVoteIndex > -1) {
			// Remove vote
			review.helpfulVotes.splice(existingVoteIndex, 1);
			review.helpfulCount = Math.max(0, (review.helpfulCount || 1) - 1);
			hasVoted = false;
		} else {
			// Add vote
			review.helpfulVotes.push(user._id);
			review.helpfulCount = (review.helpfulCount || 0) + 1;
			hasVoted = true;
		}

		await review.save();
		return {
			helpfulCount: review.helpfulCount,
			hasVoted,
		};
	}

	/**
	 * Report / Flag an inappropriate review for moderation.
	 */
	static async flagReview(reviewId, reason, user) {
		if (!mongoose.Types.ObjectId.isValid(reviewId)) {
			throw AppError.notFound("Invalid review ID");
		}

		const review = await Review.findById(reviewId);
		if (!review) {
			throw AppError.notFound("Review not found");
		}

		review.isFlagged = true;
		review.flagReason = reason.trim();
		await review.save();

		return review;
	}

	/**
	 * Recalculate average rating and dimensional breakdown for a listing.
	 */
	static async updateListingRating(listingId) {
		const listing = await Listing.findById(listingId).populate("reviews");
		if (!listing) return;

		if (!listing.reviews || listing.reviews.length === 0) {
			listing.avgRating = 0;
			listing.ratingBreakdown = {
				cleanliness: 0,
				accuracy: 0,
				communication: 0,
				location: 0,
				checkIn: 0,
				value: 0,
				stars: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
			};
		} else {
			const count = listing.reviews.length;
			const sum = listing.reviews.reduce((acc, r) => acc + (r.rating || 0), 0);
			listing.avgRating = Math.round((sum / count) * 10) / 10;

			// Dimensional averages
			const cleanSum = listing.reviews.reduce((acc, r) => acc + (r.cleanliness || r.rating || 5), 0);
			const accSum = listing.reviews.reduce((acc, r) => acc + (r.accuracy || r.rating || 5), 0);
			const commSum = listing.reviews.reduce((acc, r) => acc + (r.communication || r.rating || 5), 0);
			const locSum = listing.reviews.reduce((acc, r) => acc + (r.location || r.rating || 5), 0);
			const checkInSum = listing.reviews.reduce((acc, r) => acc + (r.checkIn || r.rating || 5), 0);
			const valSum = listing.reviews.reduce((acc, r) => acc + (r.value || r.rating || 5), 0);

			// Star distributions
			const stars = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
			listing.reviews.forEach((r) => {
				const star = Math.min(5, Math.max(1, Math.round(r.rating || 5)));
				stars[star] = (stars[star] || 0) + 1;
			});

			listing.ratingBreakdown = {
				cleanliness: Math.round((cleanSum / count) * 10) / 10,
				accuracy: Math.round((accSum / count) * 10) / 10,
				communication: Math.round((commSum / count) * 10) / 10,
				location: Math.round((locSum / count) * 10) / 10,
				checkIn: Math.round((checkInSum / count) * 10) / 10,
				value: Math.round((valSum / count) * 10) / 10,
				stars,
			};
		}

		await listing.save();
	}
}

module.exports = ReviewService;

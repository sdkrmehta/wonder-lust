const express = require("express");
const router = express.Router({ mergeParams: true });
const wrapAsync = require("../../../utils/wrapAsync");
const ApiResponse = require("../../../utils/apiResponse");
const ReviewService = require("../../../services/review.service");
const {
	isLoggedIn,
	isReviewAuthor,
	validateReview,
	validateHostReply,
	validateFlagReview,
} = require("../../../middleware");

// POST /api/v1/listings/:id/reviews - Create a review
router.post(
	"/",
	isLoggedIn,
	validateReview,
	wrapAsync(async (req, res) => {
		const newReview = await ReviewService.createReview(
			req.params.id,
			req.body.review,
			req.user,
			{ preventHostReview: true },
		);
		return ApiResponse.created(res, newReview, "Review created successfully");
	}),
);

// DELETE /api/v1/listings/:id/reviews/:reviewId - Delete review
router.delete(
	"/:reviewId",
	isLoggedIn,
	isReviewAuthor,
	wrapAsync(async (req, res) => {
		const deleted = await ReviewService.deleteReview(
			req.params.id,
			req.params.reviewId,
		);
		return ApiResponse.success(res, deleted, "Review deleted successfully");
	}),
);

// POST /api/v1/listings/:id/reviews/:reviewId/reply - Host reply
router.post(
	"/:reviewId/reply",
	isLoggedIn,
	validateHostReply,
	wrapAsync(async (req, res) => {
		const replyText = req.body.comment || (req.body.hostReply && req.body.hostReply.comment);
		const review = await ReviewService.addHostReply(
			req.params.id,
			req.params.reviewId,
			replyText,
			req.user,
		);
		return ApiResponse.success(res, review, "Host response added successfully");
	}),
);

// POST /api/v1/listings/:id/reviews/:reviewId/helpful - Toggle helpful vote
router.post(
	"/:reviewId/helpful",
	isLoggedIn,
	wrapAsync(async (req, res) => {
		const result = await ReviewService.toggleHelpfulVote(
			req.params.reviewId,
			req.user,
		);
		return ApiResponse.success(res, result);
	}),
);

// POST /api/v1/listings/:id/reviews/:reviewId/flag - Flag review
router.post(
	"/:reviewId/flag",
	isLoggedIn,
	validateFlagReview,
	wrapAsync(async (req, res) => {
		const reason = req.body.reason || "Flagged for moderation";
		const review = await ReviewService.flagReview(
			req.params.reviewId,
			reason,
			req.user,
		);
		return ApiResponse.success(res, review, "Review flagged successfully");
	}),
);

module.exports = router;

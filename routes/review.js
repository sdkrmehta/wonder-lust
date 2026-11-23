const express = require("express");
const router = express.Router({ mergeParams: true });
const wrapAsync = require("../utils/wrapAsync.js");
const {
	validateReview,
	validateHostReply,
	validateFlagReview,
	isLoggedIn,
	isReviewAuthor,
} = require("../middleware.js");
const reviewController = require("../controllers/reviews.js");

// POST Route: Add a review to a listing
router.post(
	"/",
	isLoggedIn,
	validateReview,
	wrapAsync(reviewController.createReview),
);

// DELETE Route: Delete a review from a listing
router.delete(
	"/:reviewId",
	isLoggedIn,
	isReviewAuthor,
	wrapAsync(reviewController.destroyReview),
);

// POST Route: Host reply to a review
router.post(
	"/:reviewId/reply",
	isLoggedIn,
	validateHostReply,
	wrapAsync(reviewController.addHostReply),
);

// POST Route: Helpfulness upvote
router.post(
	"/:reviewId/helpful",
	isLoggedIn,
	wrapAsync(reviewController.toggleHelpful),
);

// POST Route: Flag inappropriate review
router.post(
	"/:reviewId/flag",
	isLoggedIn,
	validateFlagReview,
	wrapAsync(reviewController.flagReview),
);

module.exports = router;

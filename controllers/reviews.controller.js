const ReviewService = require("../services/review.service");
const ApiResponse = require("../utils/apiResponse");

module.exports.createReview = async (req, res) => {
	const { id } = req.params;
	try {
		await ReviewService.createReview(id, req.body.review, req.user, {
			preventHostReview: true,
		});
		req.flash("success", "Review Submitted Successfully!");
		res.redirect(`/listings/${id}`);
	} catch (err) {
		req.flash("error", err.message || "Failed to submit review.");
		res.redirect(`/listings/${id}`);
	}
};

module.exports.destroyReview = async (req, res) => {
	const { id, reviewId } = req.params;
	try {
		await ReviewService.deleteReview(id, reviewId);
		req.flash("success", "Review Deleted Successfully!");
		res.redirect(`/listings/${id}`);
	} catch (err) {
		req.flash("error", err.message || "Failed to delete review.");
		res.redirect(`/listings/${id}`);
	}
};

module.exports.addHostReply = async (req, res) => {
	const { id, reviewId } = req.params;
	try {
		const replyText = req.body.comment || (req.body.hostReply && req.body.hostReply.comment);
		await ReviewService.addHostReply(id, reviewId, replyText, req.user);
		req.flash("success", "Host Response Posted Successfully!");
		res.redirect(`/listings/${id}`);
	} catch (err) {
		req.flash("error", err.message || "Failed to post host response.");
		res.redirect(`/listings/${id}`);
	}
};

module.exports.toggleHelpful = async (req, res) => {
	const { reviewId } = req.params;
	try {
		const result = await ReviewService.toggleHelpfulVote(reviewId, req.user);
		const isApi = req.originalUrl && req.originalUrl.startsWith("/api/");
		if (isApi) {
			return ApiResponse.success(res, result);
		}
		res.redirect("back");
	} catch (err) {
		const isApi = req.originalUrl && req.originalUrl.startsWith("/api/");
		if (isApi) {
			return ApiResponse.badRequest(res, err.message);
		}
		req.flash("error", err.message || "Failed to record vote.");
		res.redirect("back");
	}
};

module.exports.flagReview = async (req, res) => {
	const { reviewId } = req.params;
	try {
		const reason = req.body.reason || "Reported for community guidelines review";
		const review = await ReviewService.flagReview(reviewId, reason, req.user);
		const isApi = req.originalUrl && req.originalUrl.startsWith("/api/");
		if (isApi) {
			return ApiResponse.success(res, review, "Review flagged for moderation");
		}
		req.flash("success", "Review reported for community guidelines review.");
		res.redirect("back");
	} catch (err) {
		const isApi = req.originalUrl && req.originalUrl.startsWith("/api/");
		if (isApi) {
			return ApiResponse.badRequest(res, err.message);
		}
		req.flash("error", err.message || "Failed to report review.");
		res.redirect("back");
	}
};

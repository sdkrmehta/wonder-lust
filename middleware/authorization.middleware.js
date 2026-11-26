const mongoose = require("mongoose");
const Listing = require("../models/listing");
const Review = require("../models/review");

function wantsJson(req) {
	return (
		req.originalUrl.startsWith("/api/") ||
		req.xhr ||
		req.headers.accept === "application/json"
	);
}

module.exports.isOwner = async (req, res, next) => {
	const { id } = req.params;

	if (!mongoose.Types.ObjectId.isValid(id)) {
		if (wantsJson(req)) {
			return res.status(400).json({ status: "fail", message: "Invalid listing ID" });
		}
		req.flash("error", "Invalid listing ID!");
		return res.redirect("/listings");
	}

	try {
		const listing = await Listing.findById(id);

		if (!listing) {
			if (wantsJson(req)) {
				return res.status(404).json({ status: "fail", message: "Listing not found" });
			}
			req.flash("error", "Listing not found!");
			return res.redirect("/listings");
		}

		const isAdmin = req.user && req.user.role === "admin";
		if (!req.user || ((!listing.owner || !listing.owner.equals(req.user._id)) && !isAdmin)) {
			if (wantsJson(req)) {
				return res.status(403).json({
					status: "fail",
					message: "You do not have permission to perform this action",
				});
			}
			req.flash("error", "You do not have permission to perform this action!");
			return res.redirect(`/listings/${id}`);
		}

		next();
	} catch (error) {
		if (wantsJson(req)) {
			return res.status(500).json({
				status: "error",
				message: "Something went wrong while verifying permissions.",
			});
		}
		req.flash("error", "Something went wrong while verifying permissions.");
		return res.redirect("/listings");
	}
};

module.exports.isReviewAuthor = async (req, res, next) => {
	const { id, reviewId } = req.params;

	if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(reviewId)) {
		if (wantsJson(req)) {
			return res.status(400).json({ status: "fail", message: "Invalid listing or review ID" });
		}
		req.flash("error", "Invalid review ID!");
		return res.redirect("/listings");
	}

	try {
		const review = await Review.findById(reviewId);
		if (!review) {
			if (wantsJson(req)) {
				return res.status(404).json({ status: "fail", message: "Review does not exist" });
			}
			req.flash("error", "Review does not exist!");
			return res.redirect(`/listings/${id}`);
		}

		const listing = await Listing.findById(id).select("reviews");
		if (!listing || !Array.isArray(listing.reviews) || !listing.reviews.some((rid) => rid.equals(review._id))) {
			if (wantsJson(req)) {
				return res.status(404).json({ status: "fail", message: "Review not found for this listing" });
			}
			req.flash("error", "Review does not belong to this listing!");
			return res.redirect(`/listings/${id}`);
		}

		const isAdmin = req.user && req.user.role === "admin";
		if (!req.user || ((!review.author || !review.author.equals(req.user._id)) && !isAdmin)) {
			if (wantsJson(req)) {
				return res.status(403).json({
					status: "fail",
					message: "You do not have permission to delete this review",
				});
			}
			req.flash("error", "You do not have permission to delete this review!");
			return res.redirect(`/listings/${id}`);
		}
		next();
	} catch (error) {
		if (wantsJson(req)) {
			return res.status(500).json({
				status: "error",
				message: "Something went wrong while verifying review permissions.",
			});
		}
		req.flash("error", "Something went wrong while verifying review permissions.");
		return res.redirect(`/listings/${id}`);
	}
};

const mongoose = require("mongoose");
const Listing = require("../models/listing");
const Review = require("../models/review");

module.exports.isOwner = async (req, res, next) => {
	const { id } = req.params;

	if (!mongoose.Types.ObjectId.isValid(id)) {
		req.flash("error", "Invalid listing ID!");
		return res.redirect("/listings");
	}

	try {
		const listing = await Listing.findById(id);

		if (!listing) {
			req.flash("error", "Listing not found!");
			return res.redirect("/listings");
		}

		if (!listing.owner || !listing.owner.equals(req.user._id)) {
			req.flash("error", "You do not have permission to perform this action!");
			return res.redirect(`/listings/${id}`);
		}

		next();
	} catch (error) {
		req.flash("error", "Something went wrong while verifying permissions.");
		return res.redirect("/listings");
	}
};

module.exports.isReviewAuthor = async (req, res, next) => {
	const { id, reviewId } = req.params;

	if (!mongoose.Types.ObjectId.isValid(reviewId)) {
		req.flash("error", "Invalid review ID!");
		return res.redirect(`/listings/${id}`);
	}

	const review = await Review.findById(reviewId);
	if (!review) {
		req.flash("error", "Review does not exist!");
		return res.redirect(`/listings/${id}`);
	}

	if (!review.author || !review.author.equals(res.locals.currUser._id)) {
		req.flash("error", "You do not have permission to delete this review!");
		return res.redirect(`/listings/${id}`);
	}
	next();
};

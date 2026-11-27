const ListingService = require("../services/listing.service");
const ApiResponse = require("../utils/apiResponse");
const {
	MIN_LISTING_IMAGES,
	MAX_LISTING_IMAGES,
	cleanupRequestUploads,
} = require("../config/storage");

module.exports.index = async (req, res) => {
	const criteria = {
		q: req.query.q,
		category: req.query.category,
		propertyType: req.query.propertyType,
		minPrice: req.query.minPrice,
		maxPrice: req.query.maxPrice,
		bedrooms: req.query.bedrooms,
		bathrooms: req.query.bathrooms,
		guests: req.query.guests,
		amenities: req.query.amenities,
		rating: req.query.rating,
		sort: req.query.sort,
		checkIn: req.query.checkIn,
		checkOut: req.query.checkOut,
		page: req.query.page,
		limit: req.query.limit || 9,
		viewer: req.user || null,
	};

	const result = await ListingService.findListings(criteria);

	const buildUrl = (overrides = {}) => {
		const params = new URLSearchParams();
		const merged = { ...req.query, ...overrides };
		for (const [key, value] of Object.entries(merged)) {
			if (value !== undefined && value !== null && value !== "" && value !== "All") {
				if (Array.isArray(value)) {
					value.forEach((v) => {
						if (typeof v === "string" || typeof v === "number") params.append(key, v);
					});
				} else if (typeof value === "string" || typeof value === "number") {
					params.set(key, value);
				}
			}
		}
		const qs = params.toString();
		return qs ? `/listings?${qs}` : "/listings";
	};

	res.render("listings/index.ejs", {
		allListings: result.listings,
		pagination: result.pagination,
		filters: result.filters,
		activeCategory: result.filters.category,
		searchQuery: result.filters.q,
		selectedSort: result.filters.sort,
		buildUrl,
	});
};

module.exports.getSuggestions = async (req, res) => {
	const query = req.query.q || "";
	const suggestions = await ListingService.getSearchSuggestions(query);
	return ApiResponse.success(res, suggestions);
};

module.exports.renderNewForm = (req, res) => {
	res.render("listings/new.ejs");
};

module.exports.showListing = async (req, res) => {
	const { id } = req.params;
	try {
		const listing = await ListingService.getListingById(id, {
			incrementView: true,
			viewer: req.user || null,
		});
		res.render("listings/show.ejs", { listing });
	} catch (err) {
		req.flash("error", err.message || "Listing not found!");
		return res.redirect("/listings");
	}
};

module.exports.createListing = async (req, res) => {
	const files =
		req.listingImages && req.listingImages.length > 0
			? req.listingImages
			: req.file
				? [req.file]
				: [];

	if (files.length < MIN_LISTING_IMAGES || files.length > MAX_LISTING_IMAGES) {
		cleanupRequestUploads(req);
		req.flash(
			"error",
			`Please upload between ${MIN_LISTING_IMAGES} and ${MAX_LISTING_IMAGES} property photos.`,
		);
		return res.redirect("/listings/new");
	}

	const newListing = await ListingService.createListing(
		req.body.listing,
		files,
		req.user,
	);
	req.flash("success", "New Listing Created Successfully!");
	res.redirect(`/listings/${newListing._id}`);
};

module.exports.renderEditForm = async (req, res) => {
	const { id } = req.params;
	try {
		const listing = await ListingService.getListingById(id, {
			populateReviews: false,
			populateOwner: false,
			viewer: req.user || null,
		});

		let originalImageUrl = listing.image ? listing.image.url : "";
		if (originalImageUrl && originalImageUrl.includes("res.cloudinary.com")) {
			originalImageUrl = originalImageUrl.replace(
				"/upload/",
				"/upload/c_fill,h_200,w_250,q_auto,f_auto/",
			);
		}

		res.render("listings/edit.ejs", { listing, originalImageUrl });
	} catch (err) {
		req.flash("error", err.message || "Listing not found!");
		return res.redirect("/listings");
	}
};

module.exports.updateListing = async (req, res) => {
	const { id } = req.params;
	const files =
		req.listingImages && req.listingImages.length > 0
			? req.listingImages
			: req.file;

	try {
		await ListingService.updateListing(id, req.body.listing, files);
		req.flash("success", "Listing Updated Successfully!");
		res.redirect(`/listings/${id}`);
	} catch (err) {
		cleanupRequestUploads(req);
		req.flash("error", err.message || "Failed to update listing.");
		return res.redirect(`/listings/${id}/edit`);
	}
};

module.exports.destroyListing = async (req, res) => {
	const { id } = req.params;
	try {
		await ListingService.deleteListing(id);
		req.flash("success", "Listing Deleted Successfully!");
		res.redirect("/listings");
	} catch (err) {
		req.flash("error", err.message || "Failed to delete listing.");
		return res.redirect("/listings");
	}
};

module.exports.deleteImage = async (req, res) => {
	const { id, imageId } = req.params;
	try {
		await ListingService.deleteListingImage(id, imageId);
		req.flash("success", "Image removed from gallery.");
		res.redirect(`/listings/${id}/edit`);
	} catch (err) {
		req.flash("error", err.message || "Failed to delete image.");
		res.redirect(`/listings/${id}/edit`);
	}
};

module.exports.setPrimaryImage = async (req, res) => {
	const { id, imageId } = req.params;
	try {
		await ListingService.setPrimaryImage(id, imageId);
		req.flash("success", "Primary cover photo updated.");
		res.redirect(`/listings/${id}/edit`);
	} catch (err) {
		req.flash("error", err.message || "Failed to set primary image.");
		res.redirect(`/listings/${id}/edit`);
	}
};

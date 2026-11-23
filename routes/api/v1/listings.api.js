const express = require("express");
const router = express.Router();
const wrapAsync = require("../../../utils/wrapAsync");
const ApiResponse = require("../../../utils/apiResponse");
const ListingService = require("../../../services/listing.service");
const BookingService = require("../../../services/booking.service");
const reviewsApi = require("./reviews.api");
const { isLoggedIn, isOwner, validateListing, validateBooking } = require("../../../middleware");
const { handleListingUpload } = require("../../../config/storage");

// Mount Sub-Resource: Listing Reviews API
router.use("/:id/reviews", reviewsApi);

// GET /api/v1/listings/suggestions - Autocomplete suggestions
router.get(
	"/suggestions",
	wrapAsync(async (req, res) => {
		const suggestions = await ListingService.getSearchSuggestions(req.query.q);
		return ApiResponse.success(res, suggestions);
	}),
);

// GET /api/v1/listings/:id/booked-dates - Retrieve booked date intervals
router.get(
	"/:id/booked-dates",
	wrapAsync(async (req, res) => {
		const bookedDates = await BookingService.getBookedDates(req.params.id);
		return ApiResponse.success(res, bookedDates);
	}),
);

// POST /api/v1/listings/:id/bookings - Create reservation
router.post(
	"/:id/bookings",
	isLoggedIn,
	validateBooking,
	wrapAsync(async (req, res) => {
		const newBooking = await BookingService.createBooking(
			req.params.id,
			req.body.booking,
			req.user,
		);
		return ApiResponse.created(res, newBooking, "Booking confirmed successfully");
	}),
);

// GET /api/v1/listings - Retrieve all listings with search, filter, sort, & pagination
router.get(
	"/",
	wrapAsync(async (req, res) => {
		const result = await ListingService.findListings(req.query);
		return ApiResponse.success(res, {
			count: result.listings.length,
			total: result.pagination.totalListings,
			pagination: result.pagination,
			listings: result.listings,
		});
	}),
);

// POST /api/v1/listings - Create listing (Authenticated)
router.post(
	"/",
	isLoggedIn,
	handleListingUpload,
	validateListing,
	wrapAsync(async (req, res) => {
		const files =
			req.listingImages && req.listingImages.length > 0
				? req.listingImages
				: req.file;

		const newListing = await ListingService.createListing(
			req.body.listing,
			files,
			req.user,
		);
		return ApiResponse.created(res, newListing, "Listing created successfully");
	}),
);

// GET /api/v1/listings/:id - Retrieve single listing
router.get(
	"/:id",
	wrapAsync(async (req, res) => {
		const listing = await ListingService.getListingById(req.params.id, {
			incrementView: true,
		});
		return ApiResponse.success(res, listing);
	}),
);

// PUT /api/v1/listings/:id - Update listing (Owner only)
router.put(
	"/:id",
	isLoggedIn,
	isOwner,
	handleListingUpload,
	validateListing,
	wrapAsync(async (req, res) => {
		const files =
			req.listingImages && req.listingImages.length > 0
				? req.listingImages
				: req.file;

		const updated = await ListingService.updateListing(
			req.params.id,
			req.body.listing,
			files,
		);
		return ApiResponse.success(res, updated, "Listing updated successfully");
	}),
);

// DELETE /api/v1/listings/:id/images/:imageId - Delete image from gallery
router.delete(
	"/:id/images/:imageId",
	isLoggedIn,
	isOwner,
	wrapAsync(async (req, res) => {
		const updated = await ListingService.deleteListingImage(
			req.params.id,
			req.params.imageId,
		);
		return ApiResponse.success(res, updated, "Image deleted successfully");
	}),
);

// POST /api/v1/listings/:id/images/:imageId/primary - Set primary gallery image
router.post(
	"/:id/images/:imageId/primary",
	isLoggedIn,
	isOwner,
	wrapAsync(async (req, res) => {
		const updated = await ListingService.setPrimaryImage(
			req.params.id,
			req.params.imageId,
		);
		return ApiResponse.success(res, updated, "Primary image updated successfully");
	}),
);

// DELETE /api/v1/listings/:id - Delete listing (Owner only)
router.delete(
	"/:id",
	isLoggedIn,
	isOwner,
	wrapAsync(async (req, res) => {
		const deleted = await ListingService.deleteListing(req.params.id);
		return ApiResponse.success(res, deleted, "Listing deleted successfully");
	}),
);

module.exports = router;

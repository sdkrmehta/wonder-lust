const express = require("express");
const router = express.Router();
const wrapAsync = require("../utils/wrapAsync");
const { isLoggedIn, isOwner, validateListing, validateBooking } = require("../middleware");
const listingController = require("../controllers/listings");
const bookingController = require("../controllers/bookings");
const { handleListingUpload } = require("../config/storage");

// Search Autocomplete Suggestions API
router.get("/suggestions", wrapAsync(listingController.getSuggestions));

// Listing Booked Dates API
router.get("/:id/booked-dates", wrapAsync(bookingController.getBookedDates));

// Create Reservation on Listing
router.post(
	"/:id/bookings",
	isLoggedIn,
	validateBooking,
	wrapAsync(bookingController.createBooking),
);

router
	.route("/")
	.get(wrapAsync(listingController.index))
	.post(
		isLoggedIn,
		handleListingUpload,
		validateListing,
		wrapAsync(listingController.createListing),
	);

// New Listing Form
router.get("/new", isLoggedIn, listingController.renderNewForm);

router
	.route("/:id")
	.get(wrapAsync(listingController.showListing))
	.put(
		isLoggedIn,
		isOwner,
		handleListingUpload,
		validateListing,
		wrapAsync(listingController.updateListing),
	)
	.delete(isLoggedIn, isOwner, wrapAsync(listingController.destroyListing));

// Gallery Image Management
router.delete(
	"/:id/images/:imageId",
	isLoggedIn,
	isOwner,
	wrapAsync(listingController.deleteImage),
);

router.post(
	"/:id/images/:imageId/primary",
	isLoggedIn,
	isOwner,
	wrapAsync(listingController.setPrimaryImage),
);

// Edit Listing Form
router.get(
	"/:id/edit",
	isLoggedIn,
	isOwner,
	wrapAsync(listingController.renderEditForm),
);

module.exports = router;

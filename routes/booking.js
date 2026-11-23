const express = require("express");
const router = express.Router();
const wrapAsync = require("../utils/wrapAsync");
const { isLoggedIn } = require("../middleware");
const bookingController = require("../controllers/bookings");

// GET /bookings - View user's trips
router.get("/", isLoggedIn, wrapAsync(bookingController.index));

// GET /bookings/host - View reservations on host's properties
router.get("/host", isLoggedIn, wrapAsync(bookingController.hostReservations));

// GET /bookings/:id - View booking confirmation / receipt
router.get("/:id", isLoggedIn, wrapAsync(bookingController.showBooking));

// POST /bookings/:id/cancel - Cancel booking
router.post("/:id/cancel", isLoggedIn, wrapAsync(bookingController.cancelBooking));

module.exports = router;

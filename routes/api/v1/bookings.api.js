const express = require("express");
const router = express.Router();
const wrapAsync = require("../../../utils/wrapAsync");
const ApiResponse = require("../../../utils/apiResponse");
const BookingService = require("../../../services/booking.service");
const { isLoggedIn } = require("../../../middleware");

// GET /api/v1/bookings - User's trips
router.get(
	"/",
	isLoggedIn,
	wrapAsync(async (req, res) => {
		const bookings = await BookingService.getUserBookings(req.user._id);
		return ApiResponse.success(res, bookings);
	}),
);

// GET /api/v1/bookings/host - Host's reservations
router.get(
	"/host",
	isLoggedIn,
	wrapAsync(async (req, res) => {
		const reservations = await BookingService.getHostReservations(req.user._id);
		return ApiResponse.success(res, reservations);
	}),
);

// GET /api/v1/bookings/:id - Single booking
router.get(
	"/:id",
	isLoggedIn,
	wrapAsync(async (req, res) => {
		const booking = await BookingService.getBookingById(req.params.id, req.user);
		return ApiResponse.success(res, booking);
	}),
);

// PATCH /api/v1/bookings/:id/cancel - Cancel booking
router.patch(
	"/:id/cancel",
	isLoggedIn,
	wrapAsync(async (req, res) => {
		const cancelled = await BookingService.cancelBooking(req.params.id, req.user);
		return ApiResponse.success(res, cancelled, "Reservation cancelled successfully");
	}),
);

// DELETE /api/v1/bookings/:id - Cancel booking alias
router.delete(
	"/:id",
	isLoggedIn,
	wrapAsync(async (req, res) => {
		const cancelled = await BookingService.cancelBooking(req.params.id, req.user);
		return ApiResponse.success(res, cancelled, "Reservation cancelled successfully");
	}),
);

module.exports = router;

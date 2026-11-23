const BookingService = require("../services/booking.service");
const ApiResponse = require("../utils/apiResponse");

module.exports.index = async (req, res) => {
	const bookings = await BookingService.getUserBookings(req.user._id);
	res.render("bookings/index.ejs", { bookings });
};

module.exports.createBooking = async (req, res) => {
	const { id } = req.params;
	try {
		const newBooking = await BookingService.createBooking(
			id,
			req.body.booking,
			req.user,
		);
		req.flash("success", "Reservation held! Please complete payment to confirm your stay.");
		res.redirect(`/payments/checkout/${newBooking._id}`);
	} catch (err) {
		req.flash("error", err.message || "Failed to complete reservation.");
		res.redirect(`/listings/${id}`);
	}
};

module.exports.showBooking = async (req, res) => {
	const { id } = req.params;
	try {
		const booking = await BookingService.getBookingById(id, req.user);
		res.render("bookings/show.ejs", { booking });
	} catch (err) {
		req.flash("error", err.message || "Booking not found.");
		res.redirect("/bookings");
	}
};

module.exports.cancelBooking = async (req, res) => {
	const { id } = req.params;
	try {
		await BookingService.cancelBooking(id, req.user);
		req.flash("success", "Reservation has been cancelled.");
		res.redirect("/bookings");
	} catch (err) {
		req.flash("error", err.message || "Failed to cancel reservation.");
		res.redirect("/bookings");
	}
};

module.exports.getBookedDates = async (req, res) => {
	const { id } = req.params;
	const dates = await BookingService.getBookedDates(id);
	return ApiResponse.success(res, dates);
};

module.exports.hostReservations = async (req, res) => {
	const reservations = await BookingService.getHostReservations(req.user._id);
	res.render("bookings/host.ejs", { reservations });
};

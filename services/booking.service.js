const mongoose = require("mongoose");
const Booking = require("../models/booking");
const BookingNightLock = require("../models/bookingNightLock");
const Listing = require("../models/listing");
const AppError = require("../utils/AppError");
const env = require("../config/env");

function toUtcMidnight(dateInput) {
	const d = new Date(dateInput);
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function enumerateBookingNights(checkInDate, checkOutDate) {
	const startDay = toUtcMidnight(checkInDate);
	const endDay = toUtcMidnight(checkOutDate);

	const nights = [];
	const cursor = new Date(startDay);
	while (cursor < endDay) {
		nights.push(cursor.toISOString().slice(0, 10));
		cursor.setUTCDate(cursor.getUTCDate() + 1);
		if (nights.length > 365) {
			throw AppError.badRequest("Bookings cannot exceed 365 consecutive nights");
		}
	}
	return nights;
}

function isReplicaSetConnected() {
	try {
		const descType = mongoose.connection?.client?.topology?.description?.type || "";
		return descType.includes("ReplicaSet") || descType === "Sharded";
	} catch {
		return false;
	}
}

class BookingService {
	/**
	 * Compute pricing breakdown for nights, cleaning, and GST.
	 */
	static calculatePricing(nightlyPrice, checkInDate, checkOutDate) {
		const start = new Date(checkInDate);
		const end = new Date(checkOutDate);

		const diffTime = end.getTime() - start.getTime();
		const nights = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

		if (nights <= 0) {
			throw AppError.badRequest("Check-out date must be after check-in date");
		}

		const basePrice = nights * nightlyPrice;
		const cleaningFee = 500;
		const taxAmount = Math.round((basePrice + cleaningFee) * 0.18); // 18% GST
		const totalPrice = basePrice + cleaningFee + taxAmount;

		return {
			totalNights: nights,
			nightlyPrice,
			cleaningFee,
			taxAmount,
			totalPrice,
		};
	}

	/**
	 * Check if requested dates overlap with an existing booking.
	 */
	static async hasDateConflict(listingId, checkIn, checkOut, excludeBookingId = null, session = null) {
		const start = new Date(checkIn);
		const end = new Date(checkOut);

		const query = {
			listing: listingId,
			status: { $in: ["confirmed", "pending"] },
			checkIn: { $lt: end },
			checkOut: { $gt: start },
		};

		if (excludeBookingId) {
			query._id = { $ne: excludeBookingId };
		}

		const q = Booking.findOne(query);
		if (session) q.session(session);
		const conflict = await q;
		return Boolean(conflict);
	}

	/**
	 * Create and persist a new reservation atomically to prevent concurrent double-booking.
	 */
	static async createBooking(listingId, bookingData, user) {
		if (!mongoose.Types.ObjectId.isValid(listingId)) {
			throw AppError.notFound("Invalid listing ID format");
		}

		const listing = await Listing.findById(listingId);
		if (!listing) {
			throw AppError.notFound("Listing not found");
		}

		// Prevent host from booking their own property
		if (listing.owner && String(listing.owner) === String(user._id)) {
			throw AppError.badRequest("You cannot book your own property!");
		}

		const rawCheckIn = new Date(bookingData.checkIn);
		const rawCheckOut = new Date(bookingData.checkOut);
		if (Number.isNaN(rawCheckIn.getTime()) || Number.isNaN(rawCheckOut.getTime())) {
			throw AppError.badRequest("Valid check-in and check-out dates are required");
		}
		const checkIn = toUtcMidnight(rawCheckIn);
		const checkOut = toUtcMidnight(rawCheckOut);

		// Validate dates are not in the distant past (normalized to UTC date boundary)
		const now = new Date();
		const yesterdayUtc = new Date(
			Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
		);
		if (checkIn < yesterdayUtc) {
			throw AppError.badRequest("Check-in date cannot be in the past");
		}

		// Validate guest capacity
		const requestedGuests = parseInt(bookingData.guests, 10) || 1;
		const maxGuests = listing.guests || 2;
		if (requestedGuests > maxGuests) {
			throw AppError.badRequest(
				`This property can only accommodate up to ${maxGuests} guests`,
			);
		}

		// Calculate transparent pricing & discrete booked nights
		const pricing = this.calculatePricing(listing.price, checkIn, checkOut);
		const nights = enumerateBookingNights(checkIn, checkOut);
		if (nights.length === 0) {
			throw AppError.badRequest("Check-out date must be after check-in date");
		}

		const initialStatus =
			env.isProduction || env.PAYMENT_GATEWAY_MODE === "strict"
				? "pending"
				: "confirmed";

		const bookingId = new mongoose.Types.ObjectId();
		const lockDocs = nights.map((night) => ({
			listing: listingId,
			night,
			booking: bookingId,
		}));

		const createDoc = () =>
			new Booking({
				_id: bookingId,
				listing: listingId,
				user: user._id,
				checkIn,
				checkOut,
				guests: requestedGuests,
				totalNights: pricing.totalNights,
				nightlyPrice: pricing.nightlyPrice,
				cleaningFee: pricing.cleaningFee,
				taxAmount: pricing.taxAmount,
				totalPrice: pricing.totalPrice,
				status: initialStatus,
			});

		let savedBooking;
		try {
			if (isReplicaSetConnected()) {
				const session = await mongoose.startSession();
				try {
					await session.withTransaction(async () => {
						const conflict = await this.hasDateConflict(
							listingId,
							checkIn,
							checkOut,
							null,
							session,
						);
						if (conflict) {
							throw AppError.badRequest(
								"These dates are already booked! Please select another date range.",
							);
						}
						await BookingNightLock.insertMany(lockDocs, { ordered: true, session });
						savedBooking = await createDoc().save({ session });
					});
				} finally {
					await session.endSession();
				}
			} else {
				// Standalone topology: unique index on BookingNightLock provides wiredTiger atomic lock
				await BookingNightLock.insertMany(lockDocs, { ordered: true });
				try {
					const conflict = await this.hasDateConflict(listingId, checkIn, checkOut);
					if (conflict) {
						throw AppError.badRequest(
							"These dates are already booked! Please select another date range.",
						);
					}
					savedBooking = await createDoc().save();
				} catch (innerErr) {
					await BookingNightLock.deleteMany({ booking: bookingId }).catch(() => {});
					throw innerErr;
				}
			}
		} catch (err) {
			if (err && (err.code === 11000 || String(err.message || "").includes("E11000"))) {
				await BookingNightLock.deleteMany({ booking: bookingId }).catch(() => {});
				throw AppError.badRequest(
					"These dates are already booked! Please select another date range.",
				);
			}
			throw err;
		}

		// Notify host of new reservation
		try {
			const NotificationService = require("./notification.service");
			const isPending = initialStatus === "pending";
			await NotificationService.createNotification({
				recipient: listing.owner,
				sender: user._id,
				type: isPending ? "system_alert" : "booking_confirmed",
				title: isPending ? "New Pending Reservation" : "New Reservation Confirmed!",
				message: isPending
					? `${user.username || "A traveler"} initiated a booking for ${listing.title} for ${pricing.totalNights} night${pricing.totalNights > 1 ? "s" : ""} (₹${pricing.totalPrice.toLocaleString("en-IN")}) awaiting payment confirmation.`
					: `${user.username || "A traveler"} booked ${listing.title} for ${pricing.totalNights} night${pricing.totalNights > 1 ? "s" : ""} (₹${pricing.totalPrice.toLocaleString("en-IN")}).`,
				link: `/bookings/host`,
				metadata: {
					bookingId: savedBooking._id,
					listingId: listing._id,
					totalPrice: pricing.totalPrice,
				},
			});
		} catch (err) {
			console.error("[Notification Error - Booking Created]:", err.message);
		}

		return savedBooking;
	}

	/**
	 * Retrieve all booked date intervals for calendar blocking.
	 */
	static async getBookedDates(listingId) {
		if (!mongoose.Types.ObjectId.isValid(listingId)) {
			throw AppError.notFound("Invalid listing ID");
		}

		const today = new Date();
		today.setHours(0, 0, 0, 0);

		const bookings = await Booking.find({
			listing: listingId,
			status: { $in: ["confirmed", "pending"] },
			checkOut: { $gte: today },
		})
			.select("checkIn checkOut -_id")
			.lean()
			.exec();

		return bookings;
	}

	/**
	 * Retrieve all trips/bookings created by a guest.
	 */
	static async getUserBookings(userId) {
		return await Booking.find({ user: userId })
			.populate({
				path: "listing",
				select: "title location country price image images propertyType",
			})
			.populate("payment")
			.sort({ checkIn: -1 })
			.lean()
			.exec();
	}

	/**
	 * Retrieve all reservations made across listings owned by a host.
	 */
	static async getHostReservations(hostId) {
		const hostListings = await Listing.find({ owner: hostId }).select("_id").lean();
		const listingIds = hostListings.map((l) => l._id);

		return await Booking.find({ listing: { $in: listingIds } })
			.populate("listing", "title location country image")
			.populate("user", "username email")
			.sort({ checkIn: -1 })
			.lean()
			.exec();
	}

	/**
	 * Retrieve a single booking with security authorization check.
	 */
	static async getBookingById(bookingId, user = null) {
		if (!mongoose.Types.ObjectId.isValid(bookingId)) {
			throw AppError.notFound("Invalid booking ID");
		}

		const booking = await Booking.findById(bookingId)
			.populate("listing")
			.populate("user", "username email")
			.populate("payment");

		if (!booking) {
			throw AppError.notFound("Booking not found");
		}

		if (user) {
			const isGuest = String(booking.user._id) === String(user._id);
			const isHost =
				booking.listing &&
				booking.listing.owner &&
				String(booking.listing.owner) === String(user._id);

			if (!isGuest && !isHost) {
				throw AppError.forbidden("You are not authorized to view this reservation");
			}
		}

		return booking;
	}

	/**
	 * Cancel a booking and release dates. Automatically processes payment refund if paid.
	 */
	static async cancelBooking(bookingId, user) {
		const booking = await this.getBookingById(bookingId, user);

		if (booking.status === "cancelled") {
			throw AppError.badRequest("This booking is already cancelled");
		}

		booking.status = "cancelled";
		await BookingNightLock.deleteMany({ booking: booking._id });

		// Trigger automatic refund if paid
		try {
			const PaymentService = require("./payment.service");
			const refund = await PaymentService.processRefund(bookingId, user);
			if (refund) {
				booking.paymentStatus = "refunded";
			}
		} catch (e) {
			console.error("[Booking Cancellation Refund]", e.message);
		}

		await booking.save();

		// Notify host or guest of cancellation
		try {
			const NotificationService = require("./notification.service");
			const isHostCancelling =
				booking.listing &&
				booking.listing.owner &&
				String(booking.listing.owner) === String(user._id);

			// If guest cancelled, notify host
			if (!isHostCancelling && booking.listing && booking.listing.owner) {
				await NotificationService.createNotification({
					recipient: booking.listing.owner,
					sender: user._id,
					type: "booking_cancelled",
					title: "Reservation Cancelled",
					message: `${user.username || "Traveler"} cancelled their reservation for ${booking.listing.title || "property"}.`,
					link: `/bookings/host`,
					metadata: {
						bookingId: booking._id,
						listingId: booking.listing._id,
					},
				});
			}

			// If host cancelled, notify guest
			if (isHostCancelling && booking.user) {
				await NotificationService.createNotification({
					recipient: booking.user._id || booking.user,
					sender: user._id,
					type: "booking_cancelled",
					title: "Reservation Cancelled by Host",
					message: `Your booking for ${booking.listing ? booking.listing.title : "property"} was cancelled by the host.${booking.paymentStatus === "refunded" ? " Full refund processed." : ""}`,
					link: `/bookings`,
					metadata: { bookingId: booking._id },
				});
			}
		} catch (err) {
			console.error("[Notification Error - Booking Cancelled]:", err.message);
		}

		return booking;
	}
}

module.exports = BookingService;

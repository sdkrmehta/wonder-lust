const Listing = require("../models/listing");
const Booking = require("../models/booking");
const Payment = require("../models/payment");
const User = require("../models/user");
const AppError = require("../utils/AppError");

class HostService {
	/**
	 * Aggregate comprehensive host analytics, earnings, and property performances.
	 */
	static async getHostDashboardMetrics(hostId) {
		const host = await User.findById(hostId);
		if (!host) {
			throw AppError.notFound("Host account not found");
		}

		// 1. Fetch all listings owned by host
		const listings = await Listing.find({ owner: hostId }).sort({ createdAt: -1 }).lean();
		const listingIds = listings.map((l) => l._id);

		// 2. Fetch all bookings associated with host's properties
		const bookings = await Booking.find({ listing: { $in: listingIds } })
			.populate("listing", "title location country image price")
			.populate("user", "username email avatar fullName")
			.populate("payment")
			.sort({ createdAt: -1 })
			.lean();

		// 3. Compute listing metrics
		const totalListings = listings.length;
		const publishedListings = listings.filter((l) => l.status === "published" || !l.status).length;
		const draftListings = listings.filter((l) => l.status === "draft").length;
		const totalViews = listings.reduce((sum, l) => sum + (l.views || 0), 0);

		const ratedListings = listings.filter((l) => l.avgRating && l.avgRating > 0);
		const avgRating =
			ratedListings.length > 0
				? (
						ratedListings.reduce((sum, l) => sum + l.avgRating, 0) / ratedListings.length
					).toFixed(1)
				: "New";

		// 4. Compute financial & reservation metrics
		const totalBookings = bookings.length;
		const confirmedBookings = bookings.filter((b) => b.status === "confirmed").length;
		const cancelledBookings = bookings.filter((b) => b.status === "cancelled").length;
		const completedBookings = bookings.filter((b) => b.status === "completed").length;

		// Active non-cancelled revenue
		const activeBookings = bookings.filter((b) => b.status !== "cancelled");
		const totalRevenue = activeBookings.reduce((sum, b) => sum + (b.totalPrice || 0), 0);
		const netEarnings = Math.round(totalRevenue * 0.9); // 90% Host Payout (10% platform fee)

		// 5. Monthly Earnings Breakdown
		const currentYear = new Date().getFullYear();
		const monthNames = [
			"Jan", "Feb", "Mar", "Apr", "May", "Jun",
			"Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
		];
		const monthlyEarningsMap = {};
		for (let i = 0; i < 12; i++) {
			monthlyEarningsMap[i] = 0;
		}

		activeBookings.forEach((b) => {
			const date = new Date(b.createdAt || b.checkIn);
			if (date.getFullYear() === currentYear) {
				const m = date.getMonth();
				monthlyEarningsMap[m] += b.totalPrice || 0;
			}
		});

		const monthlyEarnings = monthNames.map((name, idx) => ({
			month: name,
			revenue: monthlyEarningsMap[idx],
			netPayout: Math.round(monthlyEarningsMap[idx] * 0.9),
		}));

		// 6. Top performing properties by views & price
		const topListings = [...listings]
			.sort((a, b) => (b.views || 0) - (a.views || 0))
			.slice(0, 5);

		// 7. Recent reservations (up to 10)
		const recentBookings = bookings.slice(0, 10);

		return {
			host,
			metrics: {
				totalListings,
				publishedListings,
				draftListings,
				totalViews,
				avgRating,
				totalBookings,
				confirmedBookings,
				cancelledBookings,
				completedBookings,
				totalRevenue,
				netEarnings,
			},
			listings,
			recentBookings,
			topListings,
			monthlyEarnings,
		};
	}
}

module.exports = HostService;

const mongoose = require("mongoose");
const Schema = mongoose.Schema;

/**
 * Atomic per-night reservation lock document enforcing race-free
 * mutual exclusion across concurrent booking requests via MongoDB unique index.
 */
const bookingNightLockSchema = new Schema(
	{
		listing: {
			type: Schema.Types.ObjectId,
			ref: "Listing",
			required: true,
		},
		night: {
			type: String,
			required: true,
		},
		booking: {
			type: Schema.Types.ObjectId,
			ref: "Booking",
			required: true,
		},
	},
	{ timestamps: true },
);

bookingNightLockSchema.index({ listing: 1, night: 1 }, { unique: true });
bookingNightLockSchema.index({ booking: 1 });

module.exports = mongoose.model("BookingNightLock", bookingNightLockSchema);

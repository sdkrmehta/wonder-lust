const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const bookingSchema = new Schema(
	{
		listing: {
			type: Schema.Types.ObjectId,
			ref: "Listing",
			required: [true, "Listing reference is required"],
		},
		user: {
			type: Schema.Types.ObjectId,
			ref: "User",
			required: [true, "User reference is required"],
		},
		checkIn: {
			type: Date,
			required: [true, "Check-in date is required"],
		},
		checkOut: {
			type: Date,
			required: [true, "Check-out date is required"],
		},
		guests: {
			type: Number,
			required: [true, "Number of guests is required"],
			min: [1, "At least 1 guest is required"],
			default: 1,
		},
		totalNights: {
			type: Number,
			required: [true, "Total nights is required"],
			min: [1, "Booking must be for at least 1 night"],
		},
		nightlyPrice: {
			type: Number,
			required: [true, "Nightly price is required"],
			min: 0,
		},
		cleaningFee: {
			type: Number,
			default: 500,
		},
		taxAmount: {
			type: Number,
			default: 0,
		},
		totalPrice: {
			type: Number,
			required: [true, "Total price is required"],
			min: 0,
		},
		status: {
			type: String,
			enum: ["pending", "confirmed", "cancelled", "completed"],
			default: "confirmed",
		},
		paymentStatus: {
			type: String,
			enum: ["unpaid", "paid", "refunded"],
			default: "unpaid",
		},
		payment: {
			type: Schema.Types.ObjectId,
			ref: "Payment",
		},
	},
	{ timestamps: true },
);

// High performance indexes for date overlap checking and user bookings
bookingSchema.index({ listing: 1, checkIn: 1, checkOut: 1, status: 1 });
bookingSchema.index({ listing: 1, status: 1 });
bookingSchema.index({ user: 1, createdAt: -1 });
bookingSchema.index({ status: 1, createdAt: -1 });

const Booking = mongoose.model("Booking", bookingSchema);
module.exports = Booking;

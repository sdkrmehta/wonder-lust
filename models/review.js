const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const reviewSchema = new Schema({
	comment: {
		type: String,
		required: [true, "Review comment is required"],
		trim: true,
	},
	rating: {
		type: Number,
		required: [true, "Rating is required"],
		min: [1, "Rating must be at least 1"],
		max: [5, "Rating cannot exceed 5"],
	},
	cleanliness: {
		type: Number,
		min: 1,
		max: 5,
		default: 5,
	},
	accuracy: {
		type: Number,
		min: 1,
		max: 5,
		default: 5,
	},
	communication: {
		type: Number,
		min: 1,
		max: 5,
		default: 5,
	},
	location: {
		type: Number,
		min: 1,
		max: 5,
		default: 5,
	},
	checkIn: {
		type: Number,
		min: 1,
		max: 5,
		default: 5,
	},
	value: {
		type: Number,
		min: 1,
		max: 5,
		default: 5,
	},
	isVerifiedStay: {
		type: Boolean,
		default: false,
	},
	hostReply: {
		comment: { type: String, trim: true },
		repliedAt: { type: Date },
		author: { type: Schema.Types.ObjectId, ref: "User" },
	},
	helpfulVotes: [
		{
			type: Schema.Types.ObjectId,
			ref: "User",
		},
	],
	helpfulCount: {
		type: Number,
		default: 0,
	},
	isFlagged: {
		type: Boolean,
		default: false,
	},
	flagReason: {
		type: String,
		trim: true,
	},
	author: {
		type: Schema.Types.ObjectId,
		ref: "User",
	},
	createdAt: {
		type: Date,
		default: Date.now,
	},
});

// High-performance query indexes
reviewSchema.index({ author: 1, createdAt: -1 });
reviewSchema.index({ isFlagged: 1, createdAt: -1 });
reviewSchema.index({ rating: 1 });

module.exports = mongoose.model("Review", reviewSchema);

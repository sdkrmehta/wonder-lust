const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const rateLimitHitSchema = new Schema(
	{
		key: {
			type: String,
			required: true,
			unique: true,
		},
		totalHits: {
			type: Number,
			required: true,
			default: 0,
		},
		resetTime: {
			type: Date,
			required: true,
		},
	},
	{
		collection: "rate_limit_hits",
		versionKey: false,
	},
);

// Automatically purge expired rate-limit windows via MongoDB TTL reaper
rateLimitHitSchema.index({ resetTime: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("RateLimitHit", rateLimitHitSchema);

const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const emailOtpSchema = new Schema(
	{
		user: {
			type: Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		email: {
			type: String,
			required: true,
			lowercase: true,
			trim: true,
		},
		purpose: {
			type: String,
			enum: ["signup_verification", "email_change"],
			default: "signup_verification",
		},
		otpHash: {
			type: String,
			required: true,
		},
		expiresAt: {
			type: Date,
			required: true,
		},
		attempts: {
			type: Number,
			default: 0,
			min: 0,
		},
		maxAttempts: {
			type: Number,
			default: 5,
			min: 1,
		},
		consumedAt: {
			type: Date,
			default: null,
		},
		invalidatedAt: {
			type: Date,
			default: null,
		},
		lastSentAt: {
			type: Date,
			default: Date.now,
		},
	},
	{
		timestamps: true,
		collection: "email_otps",
	},
);

emailOtpSchema.index({ email: 1, purpose: 1, createdAt: -1 });
emailOtpSchema.index({ user: 1, purpose: 1, createdAt: -1 });
// Purge verification records 10 minutes past expiry while application logic strictly rejects expiresAt <= now
emailOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 600 });

module.exports = mongoose.model("EmailOtp", emailOtpSchema);

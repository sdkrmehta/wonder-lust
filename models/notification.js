const mongoose = require("mongoose");
const { Schema } = mongoose;

const notificationSchema = new Schema(
	{
		recipient: {
			type: Schema.Types.ObjectId,
			ref: "User",
			required: true,
			index: true,
		},
		sender: {
			type: Schema.Types.ObjectId,
			ref: "User",
			default: null,
		},
		type: {
			type: String,
			enum: [
				"booking_confirmed",
				"booking_cancelled",
				"payment_succeeded",
				"payment_refunded",
				"new_message",
				"new_review",
				"host_reply",
				"system_alert",
			],
			required: true,
			index: true,
		},
		title: {
			type: String,
			required: true,
			trim: true,
		},
		message: {
			type: String,
			required: true,
			trim: true,
		},
		link: {
			type: String,
			default: "",
			trim: true,
		},
		metadata: {
			type: Schema.Types.Mixed,
			default: {},
		},
		isRead: {
			type: Boolean,
			default: false,
			index: true,
		},
		readAt: {
			type: Date,
			default: null,
		},
	},
	{
		timestamps: true,
	},
);

// Compound index for notification list retrieval
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);

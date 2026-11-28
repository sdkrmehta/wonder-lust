const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const webhookEventSchema = new Schema(
	{
		eventId: {
			type: String,
			required: true,
			trim: true,
		},
		provider: {
			type: String,
			required: true,
			default: "razorpay",
		},
		eventType: {
			type: String,
			required: true,
		},
		payment: {
			type: Schema.Types.ObjectId,
			ref: "Payment",
			default: null,
		},
		booking: {
			type: Schema.Types.ObjectId,
			ref: "Booking",
			default: null,
		},
		paymentLinkId: {
			type: String,
			default: null,
		},
		gatewayPaymentId: {
			type: String,
			default: null,
		},
		status: {
			type: String,
			enum: ["processing", "processed"],
			default: "processed",
		},
		processedAt: {
			type: Date,
			default: Date.now,
		},
	},
	{
		timestamps: true,
		collection: "webhook_events",
	},
);

webhookEventSchema.index({ eventId: 1 }, { unique: true });
webhookEventSchema.index({ payment: 1, eventType: 1 });
webhookEventSchema.index({ processedAt: -1 });

module.exports = mongoose.model("WebhookEvent", webhookEventSchema);

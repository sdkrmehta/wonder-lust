const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const conversationSchema = new Schema(
	{
		participants: [
			{
				type: Schema.Types.ObjectId,
				ref: "User",
				required: true,
			},
		],
		listing: {
			type: Schema.Types.ObjectId,
			ref: "Listing",
		},
		booking: {
			type: Schema.Types.ObjectId,
			ref: "Booking",
		},
		lastMessage: {
			text: { type: String, default: "" },
			sender: { type: Schema.Types.ObjectId, ref: "User" },
			createdAt: { type: Date, default: Date.now },
		},
		unreadCounts: {
			type: Map,
			of: Number,
			default: {},
		},
	},
	{ timestamps: true },
);

// High-speed compound indexes for user inbox lookups
conversationSchema.index({ participants: 1 });
conversationSchema.index({ updatedAt: -1 });

const Conversation = mongoose.model("Conversation", conversationSchema);
module.exports = Conversation;

const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const messageSchema = new Schema(
	{
		conversation: {
			type: Schema.Types.ObjectId,
			ref: "Conversation",
			required: [true, "Conversation reference is required"],
		},
		sender: {
			type: Schema.Types.ObjectId,
			ref: "User",
			required: [true, "Sender reference is required"],
		},
		recipient: {
			type: Schema.Types.ObjectId,
			ref: "User",
			required: [true, "Recipient reference is required"],
		},
		body: {
			type: String,
			required: [true, "Message body cannot be empty"],
			trim: true,
		},
		read: {
			type: Boolean,
			default: false,
		},
		readAt: {
			type: Date,
		},
	},
	{ timestamps: true },
);

// Indexes for conversation threads and unread messages
messageSchema.index({ conversation: 1, createdAt: 1 });
messageSchema.index({ recipient: 1, read: 1 });

const Message = mongoose.model("Message", messageSchema);
module.exports = Message;

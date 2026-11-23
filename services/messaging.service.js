const mongoose = require("mongoose");
const Conversation = require("../models/conversation");
const Message = require("../models/message");
const Listing = require("../models/listing");
const User = require("../models/user");
const AppError = require("../utils/AppError");

class MessagingService {
	/**
	 * Find existing conversation between two users or initialize a new one.
	 */
	static async getOrCreateConversation(userAId, userBId, listingId = null) {
		if (String(userAId) === String(userBId)) {
			throw AppError.badRequest("Cannot create a conversation with yourself");
		}

		let conversation = await Conversation.findOne({
			participants: { $all: [userAId, userBId] },
			...(listingId ? { listing: listingId } : {}),
		});

		if (!conversation) {
			// Check if any conversation exists between these two users
			conversation = await Conversation.findOne({
				participants: { $all: [userAId, userBId] },
			});
		}

		if (!conversation) {
			conversation = new Conversation({
				participants: [userAId, userBId],
				listing: listingId || undefined,
				unreadCounts: new Map(),
			});
			await conversation.save();
		}

		return await Conversation.findById(conversation._id)
			.populate("participants", "username avatar fullName")
			.populate("listing", "title location country image price");
	}

	/**
	 * Send and record a message within a conversation.
	 */
	static async sendMessage({ senderId, recipientId, conversationId, body, listingId }) {
		if (!body || !body.trim()) {
			throw AppError.badRequest("Message body cannot be empty");
		}

		let conversation;
		if (conversationId) {
			if (!mongoose.Types.ObjectId.isValid(conversationId)) {
				throw AppError.notFound("Invalid conversation ID");
			}
			conversation = await Conversation.findById(conversationId);
			if (!conversation) {
				throw AppError.notFound("Conversation not found");
			}

			// Verify sender is a conversation participant
			const isParticipant = conversation.participants.some(
				(p) => String(p) === String(senderId),
			);
			if (!isParticipant) {
				throw AppError.forbidden("You are not authorized to post in this conversation");
			}

			// Resolve recipient as the other participant
			recipientId = conversation.participants.find(
				(p) => String(p) !== String(senderId),
			);
		} else {
			if (!recipientId) {
				throw AppError.badRequest("Recipient ID is required");
			}
			conversation = await this.getOrCreateConversation(senderId, recipientId, listingId);
		}

		if (String(senderId) === String(recipientId)) {
			throw AppError.badRequest("You cannot send a message to yourself");
		}

		// Create message
		const message = new Message({
			conversation: conversation._id,
			sender: senderId,
			recipient: recipientId,
			body: body.trim(),
		});

		await message.save();

		// Update conversation lastMessage & unread count
		conversation.lastMessage = {
			text: body.trim(),
			sender: senderId,
			createdAt: message.createdAt,
		};

		const recipientKey = String(recipientId);
		const currentUnread = conversation.unreadCounts.get(recipientKey) || 0;
		conversation.unreadCounts.set(recipientKey, currentUnread + 1);
		await conversation.save();

		// Notify recipient of new message
		try {
			const NotificationService = require("./notification.service");
			const User = require("../models/user");
			const senderUser = await User.findById(senderId).select("username").lean();
			const previewBody =
				body.trim().length > 60
					? body.trim().substring(0, 57) + "..."
					: body.trim();
			await NotificationService.createNotification({
				recipient: recipientId,
				sender: senderId,
				type: "new_message",
				title: `New Message from ${senderUser ? senderUser.username : "a user"}`,
				message: previewBody,
				link: `/messages/${conversation._id}`,
				metadata: {
					conversationId: conversation._id,
					messageId: message._id,
				},
			});
		} catch (err) {
			console.error("[Notification Error - Message Sent]:", err.message);
		}

		return await Message.findById(message._id)
			.populate("sender", "username avatar fullName")
			.populate("recipient", "username avatar fullName");
	}

	/**
	 * Retrieve all conversations for a user with unread counters and other participant metadata.
	 */
	static async getUserConversations(userId) {
		const rawConversations = await Conversation.find({
			participants: userId,
		})
			.populate("participants", "username avatar fullName")
			.populate("listing", "title location country image price")
			.sort({ updatedAt: -1 })
			.lean();

		return rawConversations.map((conv) => {
			const otherUser =
				(conv.participants || []).find((p) => String(p._id) !== String(userId)) || {};
			const unreadCount = conv.unreadCounts
				? conv.unreadCounts[String(userId)] || 0
				: 0;
			return {
				...conv,
				otherUser,
				unreadCount,
			};
		});
	}

	/**
	 * Retrieve messages for an active conversation and mark incoming messages as read.
	 */
	static async getConversationMessages(conversationId, userId) {
		if (!mongoose.Types.ObjectId.isValid(conversationId)) {
			throw AppError.notFound("Invalid conversation ID");
		}

		const conversation = await Conversation.findById(conversationId)
			.populate("participants", "username avatar fullName")
			.populate("listing", "title location country image price owner");

		if (!conversation) {
			throw AppError.notFound("Conversation not found");
		}

		// Security authorization: user must be a participant
		const isParticipant = conversation.participants.some(
			(p) => String(p._id) === String(userId),
		);
		if (!isParticipant) {
			throw AppError.forbidden("You are not authorized to view this conversation");
		}

		// Mark incoming unread messages as read
		await Message.updateMany(
			{
				conversation: conversationId,
				recipient: userId,
				read: false,
			},
			{
				$set: { read: true, readAt: new Date() },
			},
		);

		// Reset user's unread counter
		conversation.unreadCounts.set(String(userId), 0);
		await conversation.save();

		// Fetch messages in chronological order
		const messages = await Message.find({ conversation: conversationId })
			.populate("sender", "username avatar fullName")
			.sort({ createdAt: 1 })
			.lean();

		const otherUser =
			conversation.participants.find((p) => String(p._id) !== String(userId)) || {};

		return {
			conversation,
			otherUser,
			messages,
		};
	}

	/**
	 * Start a direct inquiry from a listing page.
	 */
	static async startInquiry(listingId, guestUser, initialMessage = null) {
		if (!mongoose.Types.ObjectId.isValid(listingId)) {
			throw AppError.notFound("Invalid listing ID format");
		}

		const listing = await Listing.findById(listingId);
		if (!listing) {
			throw AppError.notFound("Listing not found");
		}

		if (listing.owner && String(listing.owner) === String(guestUser._id)) {
			throw AppError.badRequest("You cannot message yourself about your own listing");
		}

		const conversation = await this.getOrCreateConversation(
			guestUser._id,
			listing.owner,
			listing._id,
		);

		if (initialMessage && initialMessage.trim()) {
			await this.sendMessage({
				senderId: guestUser._id,
				recipientId: listing.owner,
				conversationId: conversation._id,
				body: initialMessage.trim(),
			});
		}

		return conversation;
	}

	/**
	 * Get total unread messages count for badge notifications.
	 */
	static async getUnreadCount(userId) {
		return await Message.countDocuments({
			recipient: userId,
			read: false,
		});
	}
}

module.exports = MessagingService;

const express = require("express");
const router = express.Router();
const wrapAsync = require("../../../utils/wrapAsync");
const ApiResponse = require("../../../utils/apiResponse");
const MessagingService = require("../../../services/messaging.service");
const { isLoggedIn, validateSendMessage, validateInquiry } = require("../../../middleware");

// GET /api/v1/conversations - List conversations
router.get(
	"/",
	isLoggedIn,
	wrapAsync(async (req, res) => {
		const conversations = await MessagingService.getUserConversations(req.user._id);
		return ApiResponse.success(res, conversations);
	}),
);

// GET /api/v1/conversations/unread-count - Unread messages badge count
router.get(
	"/unread-count",
	isLoggedIn,
	wrapAsync(async (req, res) => {
		const count = await MessagingService.getUnreadCount(req.user._id);
		return ApiResponse.success(res, { unreadCount: count });
	}),
);

// GET /api/v1/conversations/:id/messages - Conversation thread messages
router.get(
	"/:id/messages",
	isLoggedIn,
	wrapAsync(async (req, res) => {
		const thread = await MessagingService.getConversationMessages(
			req.params.id,
			req.user._id,
		);
		return ApiResponse.success(res, thread);
	}),
);

// POST /api/v1/conversations/:id/messages - Send message in conversation
router.post(
	"/:id/messages",
	isLoggedIn,
	validateSendMessage,
	wrapAsync(async (req, res) => {
		const message = await MessagingService.sendMessage({
			senderId: req.user._id,
			conversationId: req.params.id,
			body: req.body.body,
		});
		return ApiResponse.created(res, message, "Message sent successfully");
	}),
);

// POST /api/v1/conversations/inquiry - Start listing inquiry
router.post(
	"/inquiry",
	isLoggedIn,
	validateInquiry,
	wrapAsync(async (req, res) => {
		const { listingId, message } = req.body;
		const conversation = await MessagingService.startInquiry(
			listingId,
			req.user,
			message || "Hi, I am interested in your property!",
		);
		return ApiResponse.created(res, conversation, "Inquiry started successfully");
	}),
);

module.exports = router;

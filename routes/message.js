const express = require("express");
const router = express.Router();
const wrapAsync = require("../utils/wrapAsync");
const { isLoggedIn, validateSendMessage } = require("../middleware");
const messagesController = require("../controllers/messages");

// GET /messages - Messaging Inbox
router.get("/", isLoggedIn, wrapAsync(messagesController.renderInbox));

// GET /messages/:conversationId - Specific conversation thread
router.get("/:conversationId", isLoggedIn, wrapAsync(messagesController.renderConversation));

// POST /messages/:conversationId - Send message in thread
router.post(
	"/:conversationId",
	isLoggedIn,
	validateSendMessage,
	wrapAsync(messagesController.sendMessage),
);

// POST /messages/inquiry/:listingId - Start inquiry from listing page
router.post(
	"/inquiry/:listingId",
	isLoggedIn,
	wrapAsync(messagesController.startInquiry),
);

module.exports = router;

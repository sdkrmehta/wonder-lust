const MessagingService = require("../services/messaging.service");
const ApiResponse = require("../utils/apiResponse");

module.exports.renderInbox = async (req, res) => {
	try {
		const conversations = await MessagingService.getUserConversations(req.user._id);
		const selectedConvId = req.query.conv || (conversations[0] ? conversations[0]._id : null);

		let activeThread = null;
		if (selectedConvId) {
			try {
				activeThread = await MessagingService.getConversationMessages(
					selectedConvId,
					req.user._id,
				);
			} catch (e) {
				// Fallback if requested conversation is invalid
				activeThread = null;
			}
		}

		res.render("messages/inbox.ejs", {
			conversations,
			activeConversation: activeThread ? activeThread.conversation : null,
			otherUser: activeThread ? activeThread.otherUser : null,
			messages: activeThread ? activeThread.messages : [],
		});
	} catch (err) {
		req.flash("error", err.message || "Failed to load messaging inbox.");
		res.redirect("/listings");
	}
};

module.exports.renderConversation = async (req, res) => {
	const { conversationId } = req.params;
	try {
		const conversations = await MessagingService.getUserConversations(req.user._id);
		const activeThread = await MessagingService.getConversationMessages(
			conversationId,
			req.user._id,
		);

		res.render("messages/inbox.ejs", {
			conversations,
			activeConversation: activeThread.conversation,
			otherUser: activeThread.otherUser,
			messages: activeThread.messages,
		});
	} catch (err) {
		req.flash("error", err.message || "Conversation not found.");
		res.redirect("/messages");
	}
};

module.exports.sendMessage = async (req, res) => {
	const { conversationId } = req.params;
	const { body } = req.body;
	try {
		const message = await MessagingService.sendMessage({
			senderId: req.user._id,
			conversationId,
			body,
		});

		const isJson = req.xhr || (req.headers.accept && req.headers.accept.includes("application/json"));
		if (isJson) {
			return ApiResponse.created(res, message, "Message sent successfully");
		}

		res.redirect(`/messages/${conversationId}`);
	} catch (err) {
		const isJson = req.xhr || (req.headers.accept && req.headers.accept.includes("application/json"));
		if (isJson) {
			return ApiResponse.badRequest(res, err.message);
		}
		req.flash("error", err.message || "Failed to send message.");
		res.redirect(`/messages/${conversationId}`);
	}
};

module.exports.startInquiry = async (req, res) => {
	const { listingId } = req.params;
	const { message } = req.body;
	try {
		const conversation = await MessagingService.startInquiry(
			listingId,
			req.user,
			message || "Hi, I am interested in your property!",
		);
		req.flash("success", "Inquiry sent! Host will respond shortly.");
		res.redirect(`/messages/${conversation._id}`);
	} catch (err) {
		req.flash("error", err.message || "Failed to send inquiry.");
		res.redirect(`/listings/${listingId}`);
	}
};

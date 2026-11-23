const mongoose = require("mongoose");
const Notification = require("../models/notification");
const AppError = require("../utils/AppError");

class NotificationService {
	/**
	 * Create and persist a new system or user notification.
	 */
	static async createNotification({
		recipient,
		sender = null,
		type,
		title,
		message,
		link = "",
		metadata = {},
	}) {
		if (!recipient || !mongoose.Types.ObjectId.isValid(recipient)) {
			throw AppError.badRequest("Valid recipient user ID is required");
		}

		if (!title || !title.trim()) {
			throw AppError.badRequest("Notification title cannot be empty");
		}

		if (!message || !message.trim()) {
			throw AppError.badRequest("Notification message cannot be empty");
		}

		// Don't send notification if sender and recipient are the same person
		if (sender && String(sender) === String(recipient)) {
			return null;
		}

		const notification = new Notification({
			recipient,
			sender: sender || null,
			type,
			title: title.trim(),
			message: message.trim(),
			link: link ? link.trim() : "",
			metadata,
		});

		await notification.save();

		return await Notification.findById(notification._id)
			.populate("sender", "username avatar fullName")
			.lean()
			.exec();
	}

	/**
	 * Retrieve paginated notifications for a user with optional isRead filter.
	 */
	static async getUserNotifications(userId, options = {}) {
		if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
			throw AppError.badRequest("Valid user ID is required");
		}

		const page = Math.max(1, parseInt(options.page, 10) || 1);
		const limit = Math.min(50, Math.max(1, parseInt(options.limit, 10) || 20));
		const skip = (page - 1) * limit;

		const filter = { recipient: userId };
		if (options.isRead !== undefined && options.isRead !== "") {
			filter.isRead = options.isRead === true || options.isRead === "true";
		}

		const [notifications, total, unreadCount] = await Promise.all([
			Notification.find(filter)
				.populate("sender", "username avatar fullName")
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(limit)
				.lean()
				.exec(),
			Notification.countDocuments(filter),
			Notification.countDocuments({ recipient: userId, isRead: false }),
		]);

		return {
			notifications,
			total,
			page,
			totalPages: Math.ceil(total / limit) || 1,
			unreadCount,
		};
	}

	/**
	 * Retrieve total unread notifications count for badge display.
	 */
	static async getUnreadCount(userId) {
		if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
			return 0;
		}
		return await Notification.countDocuments({ recipient: userId, isRead: false });
	}

	/**
	 * Mark a single notification as read by ID.
	 */
	static async markAsRead(notificationId, userId) {
		if (!mongoose.Types.ObjectId.isValid(notificationId)) {
			throw AppError.notFound("Invalid notification ID");
		}

		const notification = await Notification.findOne({
			_id: notificationId,
			recipient: userId,
		});

		if (!notification) {
			throw AppError.notFound("Notification not found");
		}

		if (!notification.isRead) {
			notification.isRead = true;
			notification.readAt = new Date();
			await notification.save();
		}

		return notification;
	}

	/**
	 * Mark all unread notifications as read for a user.
	 */
	static async markAllAsRead(userId) {
		if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
			throw AppError.badRequest("Valid user ID is required");
		}

		const result = await Notification.updateMany(
			{ recipient: userId, isRead: false },
			{ $set: { isRead: true, readAt: new Date() } },
		);

		return {
			modifiedCount: result.modifiedCount || 0,
		};
	}

	/**
	 * Delete a single notification.
	 */
	static async deleteNotification(notificationId, userId) {
		if (!mongoose.Types.ObjectId.isValid(notificationId)) {
			throw AppError.notFound("Invalid notification ID");
		}

		const notification = await Notification.findOneAndDelete({
			_id: notificationId,
			recipient: userId,
		});

		if (!notification) {
			throw AppError.notFound("Notification not found");
		}

		return { success: true, message: "Notification deleted successfully" };
	}
}

module.exports = NotificationService;

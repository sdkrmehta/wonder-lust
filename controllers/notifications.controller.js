const NotificationService = require("../services/notification.service");
const ApiResponse = require("../utils/apiResponse");

class NotificationsController {
	/**
	 * Render the User Notification Center page.
	 */
	static async renderNotifications(req, res) {
		const filter = req.query.filter === "unread" ? "unread" : "all";
		const isReadOption = filter === "unread" ? false : undefined;
		const page = parseInt(req.query.page, 10) || 1;

		const result = await NotificationService.getUserNotifications(req.user._id, {
			isRead: isReadOption,
			page,
			limit: 15,
		});

		res.render("notifications/index.ejs", {
			notifications: result.notifications,
			total: result.total,
			page: result.page,
			totalPages: result.totalPages,
			unreadCount: result.unreadCount,
			activeFilter: filter,
		});
	}

	/**
	 * Mark a single notification as read.
	 */
	static async markAsRead(req, res) {
		const notification = await NotificationService.markAsRead(req.params.id, req.user._id);
		const isApi = req.originalUrl.startsWith("/api/") || req.xhr || req.headers.accept?.includes("application/json");

		if (isApi) {
			return ApiResponse.success(res, notification, "Notification marked as read");
		}

		// When clicking "Mark as Read", keep the user in the Notification Center
		if (req.body.action === "markOnly" || req.query.action === "markOnly") {
			req.flash("success", "Notification marked as read.");
			return res.redirect("/notifications");
		}

		if (notification && notification.link) {
			return res.redirect(notification.link);
		}

		res.redirect("/notifications");
	}

	/**
	 * Mark all unread notifications as read.
	 */
	static async markAllAsRead(req, res) {
		const result = await NotificationService.markAllAsRead(req.user._id);
		const isApi = req.originalUrl.startsWith("/api/") || req.xhr || req.headers.accept?.includes("application/json");

		if (isApi) {
			return ApiResponse.success(res, result, "All notifications marked as read");
		}

		req.flash("success", "All notifications marked as read");
		res.redirect("/notifications");
	}

	/**
	 * Delete a single notification.
	 */
	static async deleteNotification(req, res) {
		const result = await NotificationService.deleteNotification(req.params.id, req.user._id);
		const isApi = req.originalUrl.startsWith("/api/") || req.xhr || req.headers.accept?.includes("application/json");

		if (isApi) {
			return ApiResponse.success(res, result, "Notification deleted successfully");
		}

		req.flash("success", "Notification removed");
		res.redirect("/notifications");
	}

	/**
	 * Retrieve unread count for badge indicators.
	 */
	static async getUnreadCount(req, res) {
		const unreadCount = await NotificationService.getUnreadCount(req.user._id);
		return ApiResponse.success(res, { unreadCount });
	}

	/**
	 * REST API: List notifications.
	 */
	static async apiListNotifications(req, res) {
		const filter = req.query.isRead;
		const page = parseInt(req.query.page, 10) || 1;
		const limit = parseInt(req.query.limit, 10) || 20;

		const result = await NotificationService.getUserNotifications(req.user._id, {
			isRead: filter,
			page,
			limit,
		});

		return ApiResponse.success(res, result);
	}
}

module.exports = NotificationsController;

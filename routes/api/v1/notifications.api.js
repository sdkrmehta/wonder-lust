const express = require("express");
const router = express.Router();
const wrapAsync = require("../../../utils/wrapAsync");
const { isLoggedIn } = require("../../../middleware/auth.middleware");
const notificationsController = require("../../../controllers/notifications.controller");

// Require authentication for all notification API endpoints
router.use(isLoggedIn);

// List notifications with optional pagination and isRead filter
router.get("/", wrapAsync(notificationsController.apiListNotifications));

// Get unread count
router.get("/unread-count", wrapAsync(notificationsController.getUnreadCount));

// Mark all as read
router.post("/mark-all-read", wrapAsync(notificationsController.markAllAsRead));

// Mark specific notification as read
router.patch("/:id/read", wrapAsync(notificationsController.markAsRead));

// Delete specific notification
router.delete("/:id", wrapAsync(notificationsController.deleteNotification));

module.exports = router;

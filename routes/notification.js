const express = require("express");
const router = express.Router();
const wrapAsync = require("../utils/wrapAsync");
const { isLoggedIn } = require("../middleware/auth.middleware");
const notificationsController = require("../controllers/notifications.controller");

// All notification routes require authentication
router.use(isLoggedIn);

// View notification center
router.get("/", wrapAsync(notificationsController.renderNotifications));

// Quick API for unread badge polling / update
router.get("/unread-count", wrapAsync(notificationsController.getUnreadCount));

// Mark all as read
router.post("/mark-all-read", wrapAsync(notificationsController.markAllAsRead));

// Mark single notification as read & navigate
router.post("/:id/read", wrapAsync(notificationsController.markAsRead));

// Delete notification
router.post("/:id/delete", wrapAsync(notificationsController.deleteNotification));
router.delete("/:id", wrapAsync(notificationsController.deleteNotification));

module.exports = router;

const express = require("express");
const router = express.Router();
const wrapAsync = require("../utils/wrapAsync");
const { isLoggedIn, isAdmin } = require("../middleware");
const adminController = require("../controllers/admin.controller");

// Require authentication and Administrator privilege for all admin routes
router.use(isLoggedIn);
router.use(isAdmin);

// Platform Overview Dashboard
router.get("/", wrapAsync(adminController.renderDashboard));

// User Directory & Role Management
router.get("/users", wrapAsync(adminController.renderUsers));
router.post("/users/:id/role", wrapAsync(adminController.updateUserRole));
router.post("/users/:id/superhost", wrapAsync(adminController.toggleSuperhost));

// Listings Governance
router.get("/listings", wrapAsync(adminController.renderListings));
router.post("/listings/:id/toggle-status", wrapAsync(adminController.toggleListingStatus));
router.post("/listings/:id/delete", wrapAsync(adminController.deleteListing));
router.delete("/listings/:id", wrapAsync(adminController.deleteListing));

// Content Moderation Queue (Reviews)
router.get("/moderation", wrapAsync(adminController.renderModeration));
router.post("/moderation/reviews/:id/dismiss", wrapAsync(adminController.dismissReviewFlag));
router.post("/moderation/reviews/:id/delete", wrapAsync(adminController.deleteReview));
router.delete("/moderation/reviews/:id", wrapAsync(adminController.deleteReview));

module.exports = router;

const express = require("express");
const router = express.Router();
const wrapAsync = require("../../../utils/wrapAsync");
const { isLoggedIn, isAdmin } = require("../../../middleware");
const adminController = require("../../../controllers/admin.controller");

// Admin API endpoints require authentication & admin role
router.use(isLoggedIn);
router.use(isAdmin);

// Platform Overview Metrics
router.get("/overview", wrapAsync(adminController.apiOverview));

// User Governance
router.get("/users", wrapAsync(adminController.apiUsers));
router.patch("/users/:id/role", wrapAsync(adminController.updateUserRole));
router.patch("/users/:id/superhost", wrapAsync(adminController.toggleSuperhost));

// Listings Governance
router.get("/listings", wrapAsync(adminController.apiListings));
router.patch("/listings/:id/status", wrapAsync(adminController.toggleListingStatus));
router.delete("/listings/:id", wrapAsync(adminController.deleteListing));

// Content Moderation
router.get("/moderation/reviews", wrapAsync(adminController.apiFlaggedReviews));
router.patch("/moderation/reviews/:id/dismiss", wrapAsync(adminController.dismissReviewFlag));
router.delete("/moderation/reviews/:id", wrapAsync(adminController.deleteReview));

module.exports = router;

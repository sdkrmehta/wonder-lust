const express = require("express");
const router = express.Router();
const wrapAsync = require("../utils/wrapAsync");
const { isLoggedIn } = require("../middleware");
const hostController = require("../controllers/host");

// Host Analytics Dashboard
router.get("/dashboard", isLoggedIn, wrapAsync(hostController.renderDashboard));

// Host Listings Management
router.get("/listings", isLoggedIn, wrapAsync(hostController.renderListings));

module.exports = router;

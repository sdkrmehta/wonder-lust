const express = require("express");
const router = express.Router();
const wrapAsync = require("../../../utils/wrapAsync");
const ApiResponse = require("../../../utils/apiResponse");
const HostService = require("../../../services/host.service");
const { isLoggedIn } = require("../../../middleware");

// GET /api/v1/host/metrics - Comprehensive host analytics
router.get(
	"/metrics",
	isLoggedIn,
	wrapAsync(async (req, res) => {
		const metricsData = await HostService.getHostDashboardMetrics(req.user._id);
		return ApiResponse.success(res, metricsData);
	}),
);

// GET /api/v1/host/reservations - Host reservations
router.get(
	"/reservations",
	isLoggedIn,
	wrapAsync(async (req, res) => {
		const data = await HostService.getHostDashboardMetrics(req.user._id);
		return ApiResponse.success(res, data.recentBookings);
	}),
);

module.exports = router;

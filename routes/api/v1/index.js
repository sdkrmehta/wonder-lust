const express = require("express");
const router = express.Router();
const listingsApi = require("./listings.api");
const bookingsApi = require("./bookings.api");
const paymentsApi = require("./payments.api");
const usersApi = require("./users.api");
const hostApi = require("./host.api");
const messagesApi = require("./messages.api");
const notificationsApi = require("./notifications.api");
const adminApi = require("./admin.api");
const ApiResponse = require("../../../utils/apiResponse");
const { getConnectionState } = require("../../../config/database");
const { isAuthorizedHealthCaller } = require("../../../middleware/auth.middleware");
const env = require("../../../config/env");

// API v1 Health Check
router.get("/health", (req, res) => {
	const dbState = getConnectionState();
	const states = {
		0: "disconnected",
		1: "connected",
		2: "connecting",
		3: "disconnecting",
	};

	const isAuthorized = isAuthorizedHealthCaller(req);

	if (env.isProduction && !isAuthorized) {
		return ApiResponse.success(res, {
			status: dbState === 1 ? "healthy" : "degraded",
		});
	}

	return ApiResponse.success(res, {
		status: dbState === 1 ? "healthy" : "degraded",
		version: "v1",
		environment: env.NODE_ENV,
		database: states[dbState] || "unknown",
		uptime: Math.round(process.uptime()),
		timestamp: new Date().toISOString(),
	});
});

// Mount API Resources
router.use("/listings", listingsApi);
router.use("/bookings", bookingsApi);
router.use("/payments", paymentsApi);
router.use("/users", usersApi);
router.use("/host", hostApi);
router.use("/conversations", messagesApi);
router.use("/messages", messagesApi);
router.use("/notifications", notificationsApi);
router.use("/admin", adminApi);

module.exports = router;

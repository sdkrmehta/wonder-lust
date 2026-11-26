const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const isProduction = process.env.NODE_ENV === "production";

function parseCorsOrigins(rawOrigin, prodMode) {
	if (rawOrigin && rawOrigin.trim()) {
		return rawOrigin
			.split(",")
			.map((origin) => origin.trim())
			.filter((origin) => origin && origin !== "*");
	}
	if (prodMode) {
		return [];
	}
	return [
		"http://localhost:3000",
		"http://localhost:8080",
		"http://127.0.0.1:3000",
		"http://127.0.0.1:8080",
	];
}

const sessionSecret =
	process.env.SECRET ||
	process.env.SESSION_SECRET ||
	(isProduction ? "" : "wonderlustsupersecretcode");

if (isProduction) {
	if (
		!sessionSecret ||
		sessionSecret === "wonderlustsupersecretcode" ||
		sessionSecret === "production_cluster_session_secret_replace_in_env" ||
		sessionSecret.length < 32
	) {
		throw new Error(
			"[CONFIG FATAL] A strong SECRET/SESSION_SECRET (>= 32 chars) must be configured in production.",
		);
	}
}

const dbUrl =
	process.env.ATLASDB_URL ||
	process.env.MONGO_URL ||
	process.env.DB_URL ||
	(isProduction ? "" : "mongodb://localhost:27017/wonderlust");

if (isProduction && !dbUrl) {
	throw new Error(
		"[CONFIG FATAL] MongoDB connection URL (ATLASDB_URL, MONGO_URL, or DB_URL) is missing in production.",
	);
}

const paymentGatewayMode =
	process.env.PAYMENT_GATEWAY_MODE ||
	(isProduction ? "strict" : "sandbox");
const paymentWebhookSecret = process.env.PAYMENT_WEBHOOK_SECRET || "";
const cookieSecure =
	process.env.COOKIE_SECURE !== undefined
		? process.env.COOKIE_SECURE === "true"
		: isProduction;

function parseTrustProxy(rawValue, prodMode) {
	if (rawValue === undefined || rawValue === "") {
		return prodMode ? 1 : false;
	}
	const trimmed = String(rawValue).trim().toLowerCase();
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	const hops = parseInt(trimmed, 10);
	if (Number.isFinite(hops) && hops >= 0) {
		return hops;
	}
	return prodMode ? 1 : false;
}

if (isProduction) {
	if (!cookieSecure) {
		throw new Error(
			"[CONFIG FATAL] COOKIE_SECURE must be true in production.",
		);
	}
	if (paymentGatewayMode === "strict" && paymentWebhookSecret.length < 32) {
		throw new Error(
			"[CONFIG FATAL] PAYMENT_WEBHOOK_SECRET (>= 32 chars) must be configured when PAYMENT_GATEWAY_MODE=strict in production.",
		);
	}
}

const env = {
	NODE_ENV: process.env.NODE_ENV || "development",
	PORT: parseInt(process.env.PORT, 10) || 8080,
	DB_URL: dbUrl,
	MONGO_REQUIRE_TLS:
		process.env.MONGO_REQUIRE_TLS !== undefined
			? process.env.MONGO_REQUIRE_TLS === "true"
			: isProduction,
	SESSION_SECRET: sessionSecret,
	SESSION_NAME: process.env.SESSION_NAME || "wanderlust.sid",
	SESSION_MAX_AGE_DAYS: Math.max(
		1,
		parseInt(process.env.SESSION_MAX_AGE_DAYS, 10) || 7,
	),
	COOKIE_SECURE: cookieSecure,
	TRUST_PROXY: parseTrustProxy(process.env.TRUST_PROXY, isProduction),
	CORS_ORIGIN: parseCorsOrigins(process.env.CORS_ORIGIN, isProduction),
	RATE_LIMIT_WINDOW_MS: Math.max(
		1000,
		parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
	),
	RATE_LIMIT_MAX_API: Math.max(
		1,
		parseInt(process.env.RATE_LIMIT_MAX_API, 10) || 500,
	),
	RATE_LIMIT_MAX_AUTH: Math.max(
		1,
		parseInt(process.env.RATE_LIMIT_MAX_AUTH, 10) || 20,
	),
	MAX_FILE_SIZE_MB: Math.min(
		20,
		Math.max(1, parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 5),
	),
	PAYMENT_GATEWAY_MODE: paymentGatewayMode,
	PAYMENT_WEBHOOK_SECRET: process.env.PAYMENT_WEBHOOK_SECRET || "",
	REQUIRE_VERIFIED_STAY_REVIEWS:
		process.env.REQUIRE_VERIFIED_STAY_REVIEWS === "true",
	HEALTH_CHECK_TOKEN: process.env.HEALTH_CHECK_TOKEN || "",
	isProduction,
	isDevelopment:
		!process.env.NODE_ENV || process.env.NODE_ENV === "development",
	isTest: process.env.NODE_ENV === "test",

	// Cloudinary (optional / pluggable)
	cloudinary: {
		cloudName: process.env.CLOUD_NAME || "",
		apiKey: process.env.CLOUD_API || process.env.CLOUD_API_KEY || "",
		apiSecret: process.env.CLOUD_API_SECRET || "",
	},
};

// Basic startup validation
if (!env.DB_URL) {
	console.error("[CONFIG ERROR] MongoDB connection URL is missing!");
}

module.exports = env;

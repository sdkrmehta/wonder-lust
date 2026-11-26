const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

function resolveEnvSecret(key, fallback = "") {
	const direct = process.env[key];
	if (typeof direct === "string" && direct.trim() !== "") {
		return direct.trim();
	}
	const filePath = process.env[`${key}_FILE`];
	if (typeof filePath === "string" && filePath.trim() !== "") {
		try {
			return fs.readFileSync(filePath.trim(), "utf8").trim();
		} catch (err) {
			console.error(`[CONFIG ERROR] Unable to read ${key}_FILE (${filePath.trim()}): ${err.message}`);
			return fallback;
		}
	}
	return fallback;
}

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
	resolveEnvSecret("SECRET") ||
	resolveEnvSecret("SESSION_SECRET") ||
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
	resolveEnvSecret("ATLASDB_URL") ||
	resolveEnvSecret("MONGO_URL") ||
	resolveEnvSecret("DB_URL") ||
	(isProduction ? "" : "mongodb://localhost:27017/wonderlust");

if (isProduction && !dbUrl) {
	throw new Error(
		"[CONFIG FATAL] MongoDB connection URL (ATLASDB_URL, MONGO_URL, or DB_URL) is missing in production.",
	);
}

const redisUrl = resolveEnvSecret("REDIS_URL");
const requestedRateLimitStore = String(process.env.RATE_LIMIT_STORE || "auto").trim().toLowerCase();
const effectiveRateLimitStore =
	requestedRateLimitStore === "auto"
		? redisUrl
			? "redis"
			: isProduction
				? "mongo"
				: "memory"
		: requestedRateLimitStore;

if (effectiveRateLimitStore === "redis" && !redisUrl) {
	throw new Error(
		"[CONFIG FATAL] REDIS_URL (or REDIS_URL_FILE) must be configured when RATE_LIMIT_STORE=redis.",
	);
}
if (!["redis", "mongo", "memory"].includes(effectiveRateLimitStore)) {
	throw new Error(
		`[CONFIG FATAL] Invalid RATE_LIMIT_STORE '${requestedRateLimitStore}'. Allowed: auto, redis, mongo, memory.`,
	);
}
if (isProduction && effectiveRateLimitStore === "memory") {
	console.warn(
		"[CONFIG WARNING] RATE_LIMIT_STORE=memory in production does not share counters across workers/instances. Configure REDIS_URL or use RATE_LIMIT_STORE=mongo.",
	);
}

const razorpayKeyId = resolveEnvSecret("RAZORPAY_KEY_ID");
const razorpayKeySecret = resolveEnvSecret("RAZORPAY_KEY_SECRET");
const razorpayWebhookSecret = resolveEnvSecret("RAZORPAY_WEBHOOK_SECRET");
const rawRazorpayApiBase = (process.env.RAZORPAY_API_BASE || "https://api.razorpay.com").trim();
let razorpayApiBase = "https://api.razorpay.com";
if (rawRazorpayApiBase) {
	try {
		const parsedBase = new URL(rawRazorpayApiBase);
		const isLoopback = parsedBase.hostname === "127.0.0.1" || parsedBase.hostname === "localhost";
		if (parsedBase.protocol === "https:" || (isLoopback && parsedBase.protocol === "http:")) {
			razorpayApiBase = parsedBase.origin;
		} else {
			console.warn("[CONFIG WARNING] Ignoring non-HTTPS RAZORPAY_API_BASE for non-loopback host.");
		}
	} catch {
		console.warn("[CONFIG WARNING] Ignoring invalid RAZORPAY_API_BASE URL.");
	}
}

const paymentGatewayMode =
	process.env.PAYMENT_GATEWAY_MODE ||
	(isProduction ? "strict" : "sandbox");
const requestedProvider = String(process.env.PAYMENT_PROVIDER || "").trim().toLowerCase();
const paymentProvider = requestedProvider
	? requestedProvider
	: razorpayKeyId && razorpayKeySecret
		? "razorpay"
		: isProduction || paymentGatewayMode === "strict"
			? "internal"
			: "sandbox";

if (!["razorpay", "internal", "sandbox"].includes(paymentProvider)) {
	throw new Error(
		`[CONFIG FATAL] Unsupported PAYMENT_PROVIDER '${paymentProvider}'. Allowed: razorpay, internal, sandbox.`,
	);
}

const paymentWebhookSecret = resolveEnvSecret("PAYMENT_WEBHOOK_SECRET");
const healthCheckToken = resolveEnvSecret("HEALTH_CHECK_TOKEN");
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
	if (paymentProvider === "razorpay" && (!razorpayKeyId || !razorpayKeySecret || !razorpayWebhookSecret)) {
		console.warn(
			"[CONFIG WARNING] Razorpay selected in production without complete RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET: server will boot, while unconfigured Razorpay payment/webhook calls will fail closed (HTTP 503).",
		);
	} else if (paymentGatewayMode === "strict" && paymentWebhookSecret.length < 32 && paymentProvider !== "razorpay") {
		console.warn(
			"[CONFIG WARNING] PAYMENT_WEBHOOK_SECRET (< 32 chars or unset) in production strict mode: server will boot, while payment checkout and webhooks remain disabled (HTTP 503) until configured.",
		);
	}
}

const env = {
	NODE_ENV: process.env.NODE_ENV || "development",
	PORT: parseInt(process.env.PORT, 10) || 8080,
	DB_URL: dbUrl,
	REDIS_URL: redisUrl,
	RATE_LIMIT_STORE: effectiveRateLimitStore,
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
	PAYMENT_PROVIDER: paymentProvider,
	PAYMENT_WEBHOOK_SECRET: paymentWebhookSecret,
	RAZORPAY_KEY_ID: razorpayKeyId,
	RAZORPAY_KEY_SECRET: razorpayKeySecret,
	RAZORPAY_WEBHOOK_SECRET: razorpayWebhookSecret,
	RAZORPAY_API_BASE: razorpayApiBase,
	PENDING_BOOKING_TTL_MINUTES: Math.max(
		1,
		parseInt(process.env.PENDING_BOOKING_TTL_MINUTES, 10) || 15,
	),
	PENDING_BOOKING_TTL_MS: Math.max(
		1000,
		parseInt(process.env.PENDING_BOOKING_TTL_MS, 10) ||
			Math.max(1, parseInt(process.env.PENDING_BOOKING_TTL_MINUTES, 10) || 15) * 60 * 1000,
	),
	BOOKING_EXPIRY_SWEEP_INTERVAL_MS: Math.max(
		1000,
		parseInt(process.env.BOOKING_EXPIRY_SWEEP_INTERVAL_MS, 10) || 60 * 1000,
	),
	REQUIRE_VERIFIED_STAY_REVIEWS:
		process.env.REQUIRE_VERIFIED_STAY_REVIEWS === "true",
	HEALTH_CHECK_TOKEN: healthCheckToken,
	isProduction,
	isDevelopment:
		!process.env.NODE_ENV || process.env.NODE_ENV === "development",
	isTest: process.env.NODE_ENV === "test",

	// Cloudinary (optional / pluggable)
	cloudinary: {
		cloudName: resolveEnvSecret("CLOUD_NAME"),
		apiKey: resolveEnvSecret("CLOUD_API") || resolveEnvSecret("CLOUD_API_KEY"),
		apiSecret: resolveEnvSecret("CLOUD_API_SECRET"),
	},
};

// Basic startup validation
if (!env.DB_URL) {
	console.error("[CONFIG ERROR] MongoDB connection URL is missing!");
}

module.exports = env;

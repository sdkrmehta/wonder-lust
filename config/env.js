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

function isRealRazorpayCredential(val) {
	if (typeof val !== "string") return false;
	const t = val.trim();
	return Boolean(t && !/^rzp_(?:test|live)_replace_with_/i.test(t) && !/^replace_with_/i.test(t));
}

function parseTrustedHttpUrl(rawUrl, fallbackUrl, requireHttpsInProd = false) {
	const candidate = String(rawUrl || "").trim();
	if (!candidate) return fallbackUrl;
	try {
		const parsed = new URL(candidate);
		const isLoopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
		if (parsed.protocol === "https:") {
			return parsed.origin;
		}
		if (parsed.protocol === "http:" && (!requireHttpsInProd || isLoopback)) {
			return parsed.origin;
		}
		console.warn(`[CONFIG WARNING] Ignoring untrusted URL protocol for '${candidate}'.`);
		return fallbackUrl;
	} catch {
		console.warn(`[CONFIG WARNING] Ignoring invalid URL '${candidate}'.`);
		return fallbackUrl;
	}
}

const port = parseInt(process.env.PORT, 10) || 8080;
const defaultAppBaseUrl = isProduction
	? "https://wonderlust.surajdeepkumarmehta.dev"
	: `http://localhost:${port}`;
const appBaseUrl = parseTrustedHttpUrl(
	process.env.APP_BASE_URL || process.env.APP_URL,
	defaultAppBaseUrl,
	isProduction,
);

const resendApiKey = resolveEnvSecret("RESEND_API_KEY");
const resendFromEmail = String(process.env.RESEND_FROM_EMAIL || "").trim();
const resendBaseUrl = parseTrustedHttpUrl(
	process.env.RESEND_BASE_URL,
	"https://api.resend.com",
	true,
);

const rawOtpHashSecret = resolveEnvSecret("OTP_HASH_SECRET");
const otpHashSecret =
	rawOtpHashSecret ||
	(isProduction ? "" : cryptoFallbackSecret(sessionSecret));

function cryptoFallbackSecret(baseSecret) {
	return `dev-otp-${baseSecret || "wonderlust-local-otp-secret"}`;
}

const otpTtlSeconds = Math.max(60, parseInt(process.env.OTP_TTL_SECONDS, 10) || 300);
const otpMaxAttempts = Math.min(20, Math.max(1, parseInt(process.env.OTP_MAX_ATTEMPTS, 10) || 5));
const otpResendCooldownSeconds = Math.max(
	5,
	parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS, 10) || 60,
);

const razorpayKeyId = resolveEnvSecret("RAZORPAY_KEY_ID");
const razorpayKeySecret = resolveEnvSecret("RAZORPAY_KEY_SECRET");
const razorpayWebhookSecret = resolveEnvSecret("RAZORPAY_WEBHOOK_SECRET");
const hasRazorpayKeys =
	isRealRazorpayCredential(razorpayKeyId) && isRealRazorpayCredential(razorpayKeySecret);
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
	: hasRazorpayKeys
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
	if (!resendApiKey || !resendFromEmail) {
		console.warn(
			"[CONFIG WARNING] RESEND_API_KEY or RESEND_FROM_EMAIL is missing in production: signup OTP delivery will fail closed (HTTP 503) until configured.",
		);
	}
	if (!otpHashSecret || otpHashSecret.length < 32) {
		console.warn(
			"[CONFIG WARNING] OTP_HASH_SECRET (< 32 chars or unset) in production: OTP issuance/verification will fail closed (HTTP 503) until configured.",
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

const cloudinaryCloudName =
	resolveEnvSecret("CLOUD_NAME") || resolveEnvSecret("CLOUDINARY_CLOUD_NAME");
const cloudinaryApiKey =
	resolveEnvSecret("CLOUD_API") ||
	resolveEnvSecret("CLOUD_API_KEY") ||
	resolveEnvSecret("CLOUDINARY_API_KEY");
const cloudinaryApiSecret =
	resolveEnvSecret("CLOUD_API_SECRET") || resolveEnvSecret("CLOUDINARY_API_SECRET");

function isRealCloudCredential(val) {
	if (typeof val !== "string") return false;
	const t = val.trim();
	return Boolean(t && !/^your_cloudinary_/i.test(t) && !/^replace_with_/i.test(t));
}

const isCloudinaryConfigured =
	isRealCloudCredential(cloudinaryCloudName) &&
	isRealCloudCredential(cloudinaryApiKey) &&
	isRealCloudCredential(cloudinaryApiSecret);

const requestedUploadStorage = String(process.env.UPLOAD_STORAGE || "auto").trim().toLowerCase();
if (!["auto", "local", "cloudinary"].includes(requestedUploadStorage)) {
	throw new Error(
		`[CONFIG FATAL] Invalid UPLOAD_STORAGE '${requestedUploadStorage}'. Allowed: auto, local, cloudinary.`,
	);
}
if (requestedUploadStorage === "cloudinary" && !isCloudinaryConfigured) {
	console.warn(
		"[CONFIG WARNING] UPLOAD_STORAGE=cloudinary requested without complete CLOUD_NAME / CLOUD_API_KEY / CLOUD_API_SECRET credentials; falling back to local disk storage.",
	);
}
const effectiveUploadStorage =
	requestedUploadStorage === "local"
		? "local"
		: isCloudinaryConfigured
			? "cloudinary"
			: "local";

const env = {
	NODE_ENV: process.env.NODE_ENV || "development",
	APP_NAME: String(process.env.APP_NAME || "Wonder-Lust").trim() || "Wonder-Lust",
	PORT: port,
	APP_BASE_URL: appBaseUrl,
	RESEND_API_KEY: resendApiKey,
	RESEND_FROM_EMAIL: resendFromEmail,
	RESEND_BASE_URL: resendBaseUrl,
	OTP_HASH_SECRET: otpHashSecret,
	OTP_TTL_SECONDS: otpTtlSeconds,
	OTP_MAX_ATTEMPTS: otpMaxAttempts,
	OTP_RESEND_COOLDOWN_SECONDS: otpResendCooldownSeconds,
	DB_URL: dbUrl,
	REDIS_URL: redisUrl,
	RATE_LIMIT_STORE: effectiveRateLimitStore,
	MONGO_REQUIRE_TLS:
		process.env.MONGO_REQUIRE_TLS !== undefined
			? process.env.MONGO_REQUIRE_TLS === "true"
			: isProduction,
	SESSION_SECRET: sessionSecret,
	SESSION_NAME: process.env.SESSION_NAME || "wonderlust.sid",
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
	UPLOAD_STORAGE: effectiveUploadStorage,
	isCloudinaryConfigured,
	CLOUDINARY_API_BASE: String(process.env.CLOUDINARY_API_BASE || "https://api.cloudinary.com")
		.trim()
		.replace(/\/+$/, ""),
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
		cloudName: cloudinaryCloudName,
		apiKey: cloudinaryApiKey,
		apiSecret: cloudinaryApiSecret,
	},
};

// Basic startup validation
if (!env.DB_URL) {
	console.error("[CONFIG ERROR] MongoDB connection URL is missing!");
}

module.exports = env;

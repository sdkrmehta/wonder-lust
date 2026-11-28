const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const env = require("./env");
const { createRateLimitStore } = require("./rateLimitStore");

/**
 * Configure Helmet HTTP Security Headers with custom Content Security Policy (CSP).
 */
function createHelmetConfig() {
	return helmet({
		contentSecurityPolicy: {
			directives: {
				defaultSrc: ["'self'"],
				scriptSrc: [
					"'self'",
					(_req, res) => `'nonce-${res.locals.cspNonce}'`,
					"https://cdn.jsdelivr.net",
					"https://unpkg.com",
					"https://cdnjs.cloudflare.com",
					"https://checkout.razorpay.com",
					"https://*.razorpay.com",
				],
				scriptSrcAttr: ["'none'"],
				styleSrc: [
					"'self'",
					(_req, res) => `'nonce-${res.locals.cspNonce}'`,
					"https://cdn.jsdelivr.net",
					"https://fonts.googleapis.com",
					"https://unpkg.com",
					"https://cdnjs.cloudflare.com",
				],
				styleSrcAttr: ["'unsafe-inline'"],
				fontSrc: [
					"'self'",
					"https://fonts.gstatic.com",
					"https://cdnjs.cloudflare.com",
				],
				imgSrc: [
					"'self'",
					"data:",
					"blob:",
					"https://images.unsplash.com",
					"https://res.cloudinary.com",
					"https://cdn.razorpay.com",
					"https://*.razorpay.com",
					"https://server.arcgisonline.com",
					"https://*.arcgisonline.com",
					"https://*.tile.openstreetmap.org",
					"https://tile.openstreetmap.org",
					"https://*.tile.openstreetmap.fr",
					"https://tile.openstreetmap.fr",
					"https://*.basemaps.cartocdn.com",
					"https://basemaps.cartocdn.com",
					"https://unpkg.com",
				],
				connectSrc: [
					"'self'",
					"https://api.razorpay.com",
					"https://lumberjack.razorpay.com",
					"https://checkout.razorpay.com",
					"https://*.razorpay.com",
					"https://server.arcgisonline.com",
					"https://*.arcgisonline.com",
					"https://*.tile.openstreetmap.org",
					"https://tile.openstreetmap.org",
					"https://*.tile.openstreetmap.fr",
					"https://tile.openstreetmap.fr",
					"https://*.basemaps.cartocdn.com",
					"https://basemaps.cartocdn.com",
					"https://nominatim.openstreetmap.org",
					"https://photon.komoot.io",
				],
				frameSrc: [
					"'self'",
					"https://api.razorpay.com",
					"https://checkout.razorpay.com",
					"https://*.razorpay.com",
				],
				objectSrc: ["'none'"],
				baseUri: ["'self'"],
				formAction: [
					"'self'",
					"https://api.razorpay.com",
					"https://checkout.razorpay.com",
					"https://*.razorpay.com",
					"https://rzp.io",
					"https://*.rzp.io",
				],
				frameAncestors: ["'self'"],
				upgradeInsecureRequests: env.isProduction ? [] : null,
			},
		},
		referrerPolicy: { policy: "strict-origin-when-cross-origin" },
		hsts: env.isProduction
			? { maxAge: 31536000, includeSubDomains: true, preload: true }
			: false,
		crossOriginEmbedderPolicy: false,
		crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
		crossOriginResourcePolicy: { policy: "cross-origin" },
	});
}

/**
 * Strict CORS Middleware configuration for REST API v1.
 */
function createCorsConfig() {
	return cors({
		origin: (origin, callback) => {
			if (!origin) {
				return callback(null, true);
			}
			if (env.CORS_ORIGIN.includes(origin)) {
				return callback(null, true);
			}
			return callback(null, false);
		},
		credentials: true,
		methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
		allowedHeaders: [
			"Content-Type",
			"Authorization",
			"X-Requested-With",
			"Accept",
			"X-CSRF-Token",
			...(env.isProduction ? [] : ["X-Test-Rate-Limit"]),
		],
		optionsSuccessStatus: 204,
	});
}

/**
 * General API Rate Limiter.
 */
const apiLimiterStore = createRateLimitStore("rl:api:");
const apiLimiter = rateLimit({
	windowMs: env.RATE_LIMIT_WINDOW_MS,
	max: (req) =>
		!env.isProduction && req.headers["x-test-rate-limit"]
			? 5
			: env.RATE_LIMIT_MAX_API,
	...(apiLimiterStore ? { store: apiLimiterStore } : {}),
	passOnStoreError: true,
	keyGenerator: (req) => {
		const useTestBucket =
			!env.isProduction && Boolean(req.headers["x-test-rate-limit"]);
		const prefix = useTestBucket ? "test-rl-api:" : "std-api:";
		return prefix + (req.ip || req.socket?.remoteAddress || "127.0.0.1");
	},
	validate: { keyGeneratorIpFallback: false },
	standardHeaders: true,
	legacyHeaders: false,
	message: {
		status: "fail",
		message: "Too many API requests from this IP. Please try again after 15 minutes.",
	},
});

/**
 * Sensitive Authentication Routes Rate Limiter.
 */
const authLimiterStore = createRateLimitStore("rl:auth:");
const authLimiter = rateLimit({
	windowMs: env.RATE_LIMIT_WINDOW_MS,
	max: (req) =>
		!env.isProduction && req.headers["x-test-rate-limit"]
			? 3
			: env.RATE_LIMIT_MAX_AUTH,
	...(authLimiterStore ? { store: authLimiterStore } : {}),
	passOnStoreError: true,
	keyGenerator: (req) => {
		const useTestBucket =
			!env.isProduction && Boolean(req.headers["x-test-rate-limit"]);
		const prefix = useTestBucket ? "test-rl-auth:" : "std-auth:";
		return prefix + (req.ip || req.socket?.remoteAddress || "127.0.0.1");
	},
	validate: { keyGeneratorIpFallback: false },
	standardHeaders: true,
	legacyHeaders: false,
	message: {
		status: "fail",
		message: "Too many authentication attempts. Please try again after 15 minutes.",
	},
	handler: (req, res, next, options) => {
		if (
			req.originalUrl.startsWith("/api/") ||
			req.xhr ||
			req.headers.accept?.includes("application/json")
		) {
			return res.status(429).json(options.message);
		}
		req.flash("error", "Too many attempts. Please try again later.");
		return res.status(429).redirect("/login");
	},
});

/**
 * Public Newsletter Rate Limiter.
 */
const newsletterLimiterStore = createRateLimitStore("rl:newsletter:");
const newsletterLimiter = rateLimit({
	windowMs: env.RATE_LIMIT_WINDOW_MS,
	max: 15,
	...(newsletterLimiterStore ? { store: newsletterLimiterStore } : {}),
	passOnStoreError: true,
	keyGenerator: (req) =>
		`std-newsletter:${req.ip || req.socket?.remoteAddress || "127.0.0.1"}`,
	validate: { keyGeneratorIpFallback: false },
	standardHeaders: true,
	legacyHeaders: false,
	message: {
		status: "fail",
		message: "Too many subscription requests. Please try again later.",
	},
});

/**
 * Email OTP Verification Attempts Rate Limiter (by IP + normalized email).
 */
const otpVerifyLimiterStore = createRateLimitStore("rl:otp-verify:");
const otpVerifyLimiter = rateLimit({
	windowMs: env.RATE_LIMIT_WINDOW_MS,
	max: (req) =>
		!env.isProduction && req.headers["x-test-rate-limit"]
			? 3
			: 15,
	...(otpVerifyLimiterStore ? { store: otpVerifyLimiterStore } : {}),
	passOnStoreError: true,
	keyGenerator: (req) => {
		const useTestBucket =
			!env.isProduction && Boolean(req.headers["x-test-rate-limit"]);
		const prefix = useTestBucket ? "test-rl-otp-verify:" : "std-otp-verify:";
		const ip = req.ip || req.socket?.remoteAddress || "127.0.0.1";
		const email =
			typeof req.body?.email === "string"
				? req.body.email.trim().toLowerCase()
				: typeof req.session?.pendingVerificationEmail === "string"
					? req.session.pendingVerificationEmail.trim().toLowerCase()
					: "";
		return `${prefix}${ip}:${email}`;
	},
	validate: { keyGeneratorIpFallback: false },
	standardHeaders: true,
	legacyHeaders: false,
	message: {
		status: "fail",
		message: "Too many OTP verification attempts. Please wait and try again later.",
	},
	handler: (req, res, _next, options) => {
		if (
			req.originalUrl.startsWith("/api/") ||
			req.xhr ||
			req.headers.accept?.includes("application/json")
		) {
			return res.status(429).json(options.message);
		}
		req.flash("error", options.message.message);
		return res.status(429).redirect("/verify-email");
	},
});

/**
 * Email OTP Resend Rate Limiter (by IP + normalized email).
 */
const otpResendLimiterStore = createRateLimitStore("rl:otp-resend:");
const otpResendLimiter = rateLimit({
	windowMs: env.RATE_LIMIT_WINDOW_MS,
	max: (req) =>
		!env.isProduction && req.headers["x-test-rate-limit"]
			? 3
			: 8,
	...(otpResendLimiterStore ? { store: otpResendLimiterStore } : {}),
	passOnStoreError: true,
	keyGenerator: (req) => {
		const useTestBucket =
			!env.isProduction && Boolean(req.headers["x-test-rate-limit"]);
		const prefix = useTestBucket ? "test-rl-otp-resend:" : "std-otp-resend:";
		const ip = req.ip || req.socket?.remoteAddress || "127.0.0.1";
		const email =
			typeof req.body?.email === "string"
				? req.body.email.trim().toLowerCase()
				: typeof req.session?.pendingVerificationEmail === "string"
					? req.session.pendingVerificationEmail.trim().toLowerCase()
					: "";
		return `${prefix}${ip}:${email}`;
	},
	validate: { keyGeneratorIpFallback: false },
	standardHeaders: true,
	legacyHeaders: false,
	message: {
		status: "fail",
		message: "Too many OTP resend requests. Please wait before trying again.",
	},
	handler: (req, res, _next, options) => {
		if (
			req.originalUrl.startsWith("/api/") ||
			req.xhr ||
			req.headers.accept?.includes("application/json")
		) {
			return res.status(429).json(options.message);
		}
		req.flash("error", options.message.message);
		return res.status(429).redirect("/verify-email");
	},
});

module.exports = {
	createHelmetConfig,
	createCorsConfig,
	apiLimiter,
	authLimiter,
	newsletterLimiter,
	otpVerifyLimiter,
	otpResendLimiter,
};

const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const env = require("./env");

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
				objectSrc: ["'none'"],
				baseUri: ["'self'"],
				formAction: ["'self'"],
				frameAncestors: ["'self'"],
				upgradeInsecureRequests: env.isProduction ? [] : null,
			},
		},
		referrerPolicy: { policy: "strict-origin-when-cross-origin" },
		hsts: env.isProduction
			? { maxAge: 31536000, includeSubDomains: true, preload: true }
			: false,
		crossOriginEmbedderPolicy: false,
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
const apiLimiter = rateLimit({
	windowMs: env.RATE_LIMIT_WINDOW_MS,
	max: (req) =>
		!env.isProduction && req.headers["x-test-rate-limit"]
			? 5
			: env.RATE_LIMIT_MAX_API,
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
const authLimiter = rateLimit({
	windowMs: env.RATE_LIMIT_WINDOW_MS,
	max: (req) =>
		!env.isProduction && req.headers["x-test-rate-limit"]
			? 3
			: env.RATE_LIMIT_MAX_AUTH,
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
const newsletterLimiter = rateLimit({
	windowMs: env.RATE_LIMIT_WINDOW_MS,
	max: 15,
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

module.exports = {
	createHelmetConfig,
	createCorsConfig,
	apiLimiter,
	authLimiter,
	newsletterLimiter,
};

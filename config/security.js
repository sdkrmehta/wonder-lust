const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

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
					"'unsafe-inline'",
					"https://cdn.jsdelivr.net",
					"https://unpkg.com",
					"https://cdnjs.cloudflare.com",
				],
				scriptSrcAttr: ["'unsafe-inline'"],
				styleSrc: [
					"'self'",
					"'unsafe-inline'",
					"https://cdn.jsdelivr.net",
					"https://fonts.googleapis.com",
					"https://unpkg.com",
					"https://cdnjs.cloudflare.com",
				],
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
			},
		},
		referrerPolicy: { policy: "strict-origin-when-cross-origin" },
		crossOriginEmbedderPolicy: false,
		crossOriginResourcePolicy: { policy: "cross-origin" },
	});
}

/**
 * CORS Middleware configuration for REST API v1.
 */
function createCorsConfig() {
	return cors({
		origin: true, // Allow request origin
		credentials: true,
		methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
		allowedHeaders: [
			"Content-Type",
			"Authorization",
			"X-Requested-With",
			"Accept",
			"X-Test-Rate-Limit",
		],
	});
}

/**
 * General API Rate Limiter.
 */
const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: (req) => (req.headers["x-test-rate-limit"] ? 5 : 500),
	keyGenerator: (req) => {
		const prefix = req.headers["x-test-rate-limit"] ? "test-rl-api:" : "std-api:";
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
	windowMs: 15 * 60 * 1000,
	max: (req) => (req.headers["x-test-rate-limit"] ? 3 : 50),
	keyGenerator: (req) => {
		const prefix = req.headers["x-test-rate-limit"] ? "test-rl-auth:" : "std-auth:";
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

module.exports = {
	createHelmetConfig,
	createCorsConfig,
	apiLimiter,
	authLimiter,
};

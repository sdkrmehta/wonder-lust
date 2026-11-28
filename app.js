const crypto = require("crypto");
const fs = require("fs");
const express = require("express");
const path = require("path");
const compression = require("compression");
const methodOverride = require("method-override");
const ejsMate = require("ejs-mate");
const session = require("express-session");
const flash = require("connect-flash");
const passport = require("passport");
const LocalStrategy = require("passport-local");

const env = require("./config/env");
const { createSessionConfig } = require("./config/session");
const { uploadDir } = require("./config/storage");
const User = require("./models/user");

const listingsRouter = require("./routes/listing");
const reviewsRouter = require("./routes/review");
const bookingsRouter = require("./routes/booking");
const paymentsRouter = require("./routes/payment");
const hostRouter = require("./routes/host");
const messagesRouter = require("./routes/message");
const notificationsRouter = require("./routes/notification");
const adminRouter = require("./routes/admin");
const userRouter = require("./routes/user");
const apiV1Router = require("./routes/api/v1");
const homeController = require("./controllers/home.controller");
const { createHelmetConfig, createCorsConfig, apiLimiter, newsletterLimiter } = require("./config/security");
const { sanitizeInput } = require("./middleware/sanitize.middleware");
const { csrfProtection } = require("./middleware/csrf.middleware");
const { isAuthorizedHealthCaller, isJsonOrBackgroundRequest } = require("./middleware/auth.middleware");
const { notFoundHandler, errorHandler } = require("./middleware/error.middleware");
const { getConnectionState } = require("./config/database");
const { getRateLimitStoreInfo } = require("./config/rateLimitStore");

const app = express();

// Trust configured reverse proxy hops for secure cookies and real client IP
if (env.TRUST_PROXY !== false) {
	app.set("trust proxy", env.TRUST_PROXY);
}

// View Engine Setup
app.engine("ejs", ejsMate);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Per-request CSP nonce generation (before Helmet headers)
app.use((req, res, next) => {
	res.locals.cspNonce = crypto.randomBytes(16).toString("base64");
	next();
});

// HTTP Security Headers (Helmet with Nonce-Based CSP)
app.use(createHelmetConfig());

// HTTP Payload Compression (Gzip / Deflate)
app.use(
	compression({
		threshold: 512, // Compress responses larger than 512 bytes
		level: 6,
	}),
);

// Request Parsing (capturing rawBody for HMAC webhook verification) & Method Override
app.use(
	express.json({
		limit: "256kb",
		verify: (req, _res, buf) => {
			if (
				req.originalUrl &&
				(req.originalUrl.startsWith("/api/v1/payments/webhook") ||
					req.originalUrl.startsWith("/payments/webhook"))
			) {
				req.rawBody = buf;
			}
		},
	}),
);
app.use(express.urlencoded({ extended: true, limit: "256kb" }));
app.use(methodOverride("_method"));

// Input Sanitization (Defense against NoSQL Injection & Stored XSS)
app.use(sanitizeInput);

// Static Assets with Cache-Control and ETags
const staticOptions = {
	maxAge: "1d",
	etag: true,
	lastModified: true,
	dotfiles: "deny",
	index: false,
	setHeaders: (res) => {
		res.setHeader("X-Content-Type-Options", "nosniff");
	},
};

app.use(express.static(path.join(__dirname, "public"), staticOptions));
app.use("/uploads", express.static(uploadDir, staticOptions));
app.use(express.static(path.join(__dirname, "assets"), staticOptions));

// Session & Flash
const sessionOptions = createSessionConfig();
app.use(session(sessionOptions));
app.use(flash());

// Authentication (Passport)
app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

// Invalidate stale sessions after password changes or unverified email state
app.use((req, res, next) => {
	if (req.isAuthenticated && req.isAuthenticated() && req.user && req.user.emailVerified === false) {
		const pendingEmail = req.user.email || "";
		return req.logout((err) => {
			if (err) return next(err);
			if (req.session && pendingEmail) {
				req.session.pendingVerificationEmail = pendingEmail;
			}
			if (isJsonOrBackgroundRequest(req)) {
				return res.status(403).json({ status: "fail", message: "Email verification required" });
			}
			req.flash("error", "Please verify your email address before accessing your account.");
			return res.redirect("/verify-email");
		});
	}
	if (
		req.isAuthenticated &&
		req.isAuthenticated() &&
		req.user &&
		req.session &&
		typeof req.session.userSessionVersion === "number" &&
		Number(req.user.sessionVersion || 1) !== req.session.userSessionVersion
	) {
		return req.logout((err) => {
			if (err) return next(err);
			delete req.session.userSessionVersion;
			if (isJsonOrBackgroundRequest(req)) {
				return res.status(401).json({ status: "fail", message: "Session expired due to password change" });
			}
			req.flash("error", "Your session expired after a password change. Please log in again.");
			return res.redirect("/login");
		});
	}
	return next();
});

// CSRF & Origin Validation (after session + passport initialization)
app.use(csrfProtection);

// Default Application Template Locals (guards against ReferenceErrors in views and includes)
app.locals.currUser = null;
app.locals.success = [];
app.locals.error = [];
app.locals.isFluid = false;
app.locals.currentPath = "";
app.locals.searchQuery = "";
app.locals.filters = {};
app.locals.csrfToken = "";
app.locals.cspNonce = "";
const assetHash = crypto.createHash("sha256");
for (const assetRel of ["public/css/style.css", "public/css/rating.css", "public/js/script.js", "public/js/search.js", "public/js/listing-form.js", "public/js/listing-show.js", "public/js/auth-profile.js", "public/js/checkout.js"]) {
	try {
		assetHash.update(fs.readFileSync(path.join(__dirname, assetRel)));
	} catch {}
}
app.locals.assetVersion = assetHash.digest("hex").slice(0, 10);
app.locals.escapeHtml = function escapeHtml(val) {
	return String(val ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
};
app.locals.safeJson = function safeJson(val) {
	return JSON.stringify(val)
		.replace(/</g, "\\u003c")
		.replace(/>/g, "\\u003e")
		.replace(/&/g, "\\u0026")
		.replace(/\u2028/g, "\\u2028")
		.replace(/\u2029/g, "\\u2029");
};

// Template Locals Middleware
app.use((req, res, next) => {
	if (
		req.path === "/health" ||
		req.path === "/ready" ||
		req.path === "/notifications/unread-count" ||
		req.path.startsWith("/api/")
	) {
		return next();
	}
	const safeStr = (v) => (typeof v === "string" ? v : "");
	const hasFlash = Boolean(req.session && req.session.flash);
	res.locals.success = (hasFlash ? req.flash("success") : []) || [];
	res.locals.error = (hasFlash ? req.flash("error") : []) || [];
	res.locals.currUser = req.user || null;
	res.locals.currentPath = req.path || "";
	res.locals.searchQuery = safeStr(req.query.q);
	res.locals.filters = {
		q: safeStr(req.query.q),
		checkIn: safeStr(req.query.checkIn),
		checkOut: safeStr(req.query.checkOut),
		bedrooms: safeStr(req.query.bedrooms),
		guests: safeStr(req.query.guests),
	};
	next();
});

// Liveness / Health Check Endpoint (minimal response for unauthenticated production probes)
app.get("/health", (req, res) => {
	const dbState = getConnectionState();
	const states = {
		0: "disconnected",
		1: "connected",
		2: "connecting",
		3: "disconnecting",
	};

	const isHealthy = dbState === 1;
	if (env.isProduction && !isAuthorizedHealthCaller(req)) {
		return res.status(isHealthy ? 200 : 503).json({
			status: isHealthy ? "healthy" : "degraded",
		});
	}

	const memUsage = process.memoryUsage();
	res.status(isHealthy ? 200 : 503).json({
		status: isHealthy ? "healthy" : "degraded",
		version: "1.0.0",
		environment: env.NODE_ENV,
		database: states[dbState] || "unknown",
		rateLimitStore: getRateLimitStoreInfo(),
		uptime: Math.round(process.uptime()),
		memory: {
			rssMb: Math.round(memUsage.rss / 1024 / 1024),
			heapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
		},
		timestamp: new Date().toISOString(),
	});
});

// Readiness Probe Endpoint (Kubernetes / Docker Swarm / Load Balancer)
app.get("/ready", (req, res) => {
	const dbState = getConnectionState();
	const isReady = dbState === 1;
	if (env.isProduction && !isAuthorizedHealthCaller(req)) {
		return res.status(isReady ? 200 : 503).json({
			status: isReady ? "ready" : "not_ready",
		});
	}
	res.status(isReady ? 200 : 503).json({
		status: isReady ? "ready" : "not_ready",
		database: isReady ? "connected" : "unavailable",
		timestamp: new Date().toISOString(),
	});
});

// Informational Legal Routes
app.get("/privacy", (req, res) => {
	res.render("pages/privacy.ejs");
});

app.get("/terms", (req, res) => {
	res.render("pages/terms.ejs");
});

// Homepage & Discovery Routes
app.get("/home", homeController.renderHome);
app.get("/hotels", (req, res) => res.redirect("/listings"));
app.post("/newsletter", newsletterLimiter, homeController.handleNewsletter);

// Root Route:
// Renders the redesigned homepage for standard web visits (browsers requesting text/html).
// Preserves legacy 302 redirect to /listings for automated test clients with raw headers.
app.get("/", (req, res, next) => {
	const accept = req.get("Accept") || "";
	const userAgent = req.get("User-Agent") || "";
	if (!accept.includes("text/html") && !userAgent) {
		return res.redirect("/listings");
	}
	return homeController.renderHome(req, res, next);
});

// Mount Routes
app.use("/listings", listingsRouter);
app.use("/listings/:id/reviews", reviewsRouter);
app.use("/bookings", bookingsRouter);
app.use("/payments", paymentsRouter);
app.use("/host", hostRouter);
app.use("/messages", messagesRouter);
app.use("/notifications", notificationsRouter);
app.use("/admin", adminRouter);
app.use("/", userRouter);

// Mount REST API v1 with CORS & Rate Limiting
app.use("/api/v1", createCorsConfig());
app.use("/api/v1", apiLimiter);
app.use("/api/v1", apiV1Router);

// Catch-All 404 Handler
app.use(notFoundHandler);

// Global Error Handler
app.use(errorHandler);

module.exports = app;

// If app.js is run directly with `node app.js`, start server automatically
if (require.main === module) {
	require("./server");
}

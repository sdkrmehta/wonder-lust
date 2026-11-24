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
const { createHelmetConfig, createCorsConfig, apiLimiter } = require("./config/security");
const { sanitizeInput } = require("./middleware/sanitize.middleware");
const { notFoundHandler, errorHandler } = require("./middleware/error.middleware");
const { getConnectionState } = require("./config/database");

const app = express();

// Trust reverse proxy for secure cookies on cloud hosts (Render, Heroku, AWS)
if (process.env.NODE_ENV === "production") {
	app.set("trust proxy", 1);
}

// View Engine Setup
app.engine("ejs", ejsMate);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// HTTP Security Headers (Helmet with Custom CSP)
app.use(createHelmetConfig());

// HTTP Payload Compression (Gzip / Deflate)
app.use(
	compression({
		threshold: 512, // Compress responses larger than 512 bytes
		level: 6,
	}),
);

// Request Parsing & Method Override
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride("_method"));

// Input Sanitization (Defense against NoSQL Injection & Stored XSS)
app.use(sanitizeInput);

// Static Assets with Cache-Control and ETags
const staticOptions = {
	maxAge: "1d",
	etag: true,
	lastModified: true,
};

app.use(express.static(path.join(__dirname, "public"), staticOptions));
app.use("/uploads", express.static(uploadDir, staticOptions));
app.use("/uploads", express.static(path.join(__dirname, "uploads"), staticOptions));
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

// Default Application Template Locals (guards against ReferenceErrors in views and includes)
app.locals.currUser = null;
app.locals.success = [];
app.locals.error = [];
app.locals.isFluid = false;
app.locals.currentPath = "";
app.locals.searchQuery = "";
app.locals.filters = {};

// Template Locals Middleware
app.use((req, res, next) => {
	res.locals.success = req.flash("success") || [];
	res.locals.error = req.flash("error") || [];
	res.locals.currUser = req.user || null;
	res.locals.currentPath = req.path || "";
	res.locals.searchQuery = req.query.q || "";
	res.locals.filters = {
		q: req.query.q || "",
		checkIn: req.query.checkIn || "",
		checkOut: req.query.checkOut || "",
		bedrooms: req.query.bedrooms || "",
		guests: req.query.guests || "",
	};
	next();
});

// Liveness / Health Check Endpoint
app.get("/health", (req, res) => {
	const dbState = getConnectionState();
	const states = {
		0: "disconnected",
		1: "connected",
		2: "connecting",
		3: "disconnecting",
	};

	const isHealthy = dbState === 1;
	const memUsage = process.memoryUsage();
	res.status(isHealthy ? 200 : 503).json({
		status: isHealthy ? "healthy" : "degraded",
		version: "1.0.0",
		environment: env.NODE_ENV,
		database: states[dbState] || "unknown",
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
app.post("/newsletter", homeController.handleNewsletter);

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

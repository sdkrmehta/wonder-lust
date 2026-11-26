const crypto = require("crypto");
const env = require("../config/env");

function sanitizeInternalRedirect(target, fallback = "/listings") {
	if (typeof target !== "string") return fallback;
	const trimmed = target.trim();
	if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
		return fallback;
	}
	if (/[\r\n\0]/.test(trimmed)) {
		return fallback;
	}
	return trimmed;
}

module.exports.sanitizeInternalRedirect = sanitizeInternalRedirect;

module.exports.isLoggedIn = (req, res, next) => {
	if (!req.isAuthenticated()) {
		// Only save idempotent GET requests to avoid redirecting to POST/PUT/DELETE
		if (req.method === "GET") {
			req.session.redirectUrl = sanitizeInternalRedirect(req.originalUrl, "/listings");
		}
		if (req.originalUrl.startsWith("/api/") || req.xhr) {
			return res.status(401).json({ status: "fail", message: "Authentication required" });
		}
		req.flash("error", "Please log in to continue.");
		return res.redirect("/login");
	}
	next();
};

module.exports.isAdmin = (req, res, next) => {
	if (!req.isAuthenticated()) {
		if (req.method === "GET") {
			req.session.redirectUrl = sanitizeInternalRedirect(req.originalUrl, "/listings");
		}
		if (req.originalUrl.startsWith("/api/") || req.xhr) {
			return res.status(401).json({ status: "fail", message: "Authentication required" });
		}
		req.flash("error", "Please log in to continue.");
		return res.redirect("/login");
	}

	if (req.user.role !== "admin") {
		if (req.originalUrl.startsWith("/api/") || req.xhr) {
			return res.status(403).json({ status: "fail", message: "Forbidden: Admin privileges required" });
		}
		req.flash("error", "Access denied. Administrator privileges required.");
		return res.redirect("/listings");
	}

	next();
};

module.exports.saveRedirectUrl = (req, res, next) => {
	if (req.session.redirectUrl) {
		res.locals.redirectUrl = sanitizeInternalRedirect(req.session.redirectUrl, "/listings");
	}
	next();
};

function timingSafeTokenEqual(provided, expected) {
	if (typeof provided !== "string" || typeof expected !== "string" || !provided || !expected) {
		return false;
	}
	const bufA = Buffer.from(provided, "utf8");
	const bufB = Buffer.from(expected, "utf8");
	if (bufA.length !== bufB.length) {
		return false;
	}
	return crypto.timingSafeEqual(bufA, bufB);
}

module.exports.isAuthorizedHealthCaller = (req) => {
	if (req.isAuthenticated && req.isAuthenticated() && req.user && req.user.role === "admin") {
		return true;
	}
	if (env.HEALTH_CHECK_TOKEN && timingSafeTokenEqual(req.get("x-health-token") || "", env.HEALTH_CHECK_TOKEN)) {
		return true;
	}
	return false;
};

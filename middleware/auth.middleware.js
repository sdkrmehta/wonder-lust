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

function isNonPageRedirectTarget(target) {
	if (typeof target !== "string") return true;
	const pathOnly = target.trim().split("?")[0].split("#")[0].toLowerCase();
	return (
		pathOnly.startsWith("/api/") ||
		pathOnly === "/notifications/unread-count" ||
		pathOnly === "/health" ||
		pathOnly === "/ready" ||
		pathOnly === "/login" ||
		pathOnly === "/logout" ||
		pathOnly === "/signup" ||
		pathOnly === "/favicon.ico" ||
		pathOnly.endsWith(".json")
	);
}

function sanitizeLoginRedirect(target, fallback = "/listings") {
	const safe = sanitizeInternalRedirect(target, fallback);
	return isNonPageRedirectTarget(safe) ? fallback : safe;
}

function isJsonOrBackgroundRequest(req) {
	const urlPath = (req.originalUrl || "").split("?")[0].toLowerCase();
	const accept = (req.get("accept") || "").toLowerCase();
	const secFetchDest = (req.get("sec-fetch-dest") || "").toLowerCase();
	return (
		req.originalUrl.startsWith("/api/") ||
		Boolean(req.xhr) ||
		(accept.includes("application/json") && !accept.includes("text/html")) ||
		(Boolean(secFetchDest) && secFetchDest !== "document") ||
		urlPath === "/notifications/unread-count" ||
		urlPath === "/health" ||
		urlPath === "/ready" ||
		urlPath === "/favicon.ico" ||
		urlPath.endsWith(".json")
	);
}

module.exports.sanitizeInternalRedirect = sanitizeInternalRedirect;
module.exports.sanitizeLoginRedirect = sanitizeLoginRedirect;
module.exports.isNonPageRedirectTarget = isNonPageRedirectTarget;
module.exports.isJsonOrBackgroundRequest = isJsonOrBackgroundRequest;

module.exports.isLoggedIn = (req, res, next) => {
	if (!req.isAuthenticated()) {
		if (isJsonOrBackgroundRequest(req)) {
			return res.status(401).json({ status: "fail", message: "Authentication required" });
		}
		// Only save idempotent GET page navigations to avoid redirecting to API/POST/background routes
		if (req.method === "GET") {
			req.session.redirectUrl = sanitizeLoginRedirect(req.originalUrl, "/listings");
		}
		req.flash("error", "Please log in to continue.");
		return res.redirect("/login");
	}
	next();
};

module.exports.isAdmin = (req, res, next) => {
	if (!req.isAuthenticated()) {
		if (isJsonOrBackgroundRequest(req)) {
			return res.status(401).json({ status: "fail", message: "Authentication required" });
		}
		if (req.method === "GET") {
			req.session.redirectUrl = sanitizeLoginRedirect(req.originalUrl, "/listings");
		}
		req.flash("error", "Please log in to continue.");
		return res.redirect("/login");
	}

	if (req.user.role !== "admin") {
		if (isJsonOrBackgroundRequest(req)) {
			return res.status(403).json({ status: "fail", message: "Forbidden: Admin privileges required" });
		}
		req.flash("error", "Access denied. Administrator privileges required.");
		return res.redirect("/listings");
	}

	next();
};

module.exports.saveRedirectUrl = (req, res, next) => {
	if (req.session && req.session.redirectUrl) {
		res.locals.redirectUrl = sanitizeLoginRedirect(req.session.redirectUrl, "/listings");
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

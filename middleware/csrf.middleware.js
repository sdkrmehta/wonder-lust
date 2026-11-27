const crypto = require("crypto");
const env = require("../config/env");

function generateCsrfToken() {
	return crypto.randomBytes(32).toString("hex");
}

function extractHost(urlStr) {
	if (!urlStr || typeof urlStr !== "string" || urlStr === "null") {
		return null;
	}
	try {
		return new URL(urlStr).host.toLowerCase();
	} catch {
		return null;
	}
}

function timingSafeCompare(a, b) {
	if (typeof a !== "string" || typeof b !== "string" || !a || !b) {
		return false;
	}
	const bufA = Buffer.from(a, "utf8");
	const bufB = Buffer.from(b, "utf8");
	if (bufA.length !== bufB.length) {
		return false;
	}
	return crypto.timingSafeEqual(bufA, bufB);
}

function sendCsrfFailure(req, res, message) {
	const isApi =
		req.originalUrl.startsWith("/api/") ||
		req.xhr ||
		req.headers.accept === "application/json";
	if (isApi) {
		return res.status(403).json({ status: "fail", message });
	}
	return res.status(403).render("error.ejs", { message });
}

function isOriginAllowed(req) {
	const secFetchSite = (req.get("sec-fetch-site") || "").toLowerCase();
	if (secFetchSite === "cross-site") {
		return false;
	}

	const origin = req.get("origin");
	const referer = req.get("referer");
	const requestHost = (req.get("host") || "").toLowerCase();
	const isApi = req.originalUrl.startsWith("/api/") || req.path.startsWith("/api/");
	const allowedCorsHosts = isApi
		? env.CORS_ORIGIN.map(extractHost).filter(Boolean)
		: [];

	if (origin !== undefined) {
		const originHost = extractHost(origin);
		if (!originHost) return false;
		if (originHost !== requestHost && !allowedCorsHosts.includes(originHost)) {
			return false;
		}
	} else if (referer !== undefined) {
		const refererHost = extractHost(referer);
		if (!refererHost) return false;
		if (refererHost !== requestHost && !allowedCorsHosts.includes(refererHost)) {
			return false;
		}
	}

	return true;
}

function hasBrowserCsrfContext(req) {
	const ua = req.get("user-agent") || "";
	return Boolean(
		req.get("origin") ||
			req.get("referer") ||
			req.get("sec-fetch-site") ||
			/Mozilla|Chrome|Safari|Firefox|Edg|Opera|AppleWebKit/i.test(ua),
	);
}

function isMultipartUploadRoute(req) {
	const method = (req.method || "").toUpperCase();
	const routePath = req.path || "/";
	if (method === "POST") {
		return (
			/^\/listings\/?$/i.test(routePath) ||
			/^\/api\/v1\/listings\/?$/i.test(routePath)
		);
	}
	if (method === "PUT") {
		return (
			/^\/listings\/[^/]+\/?$/i.test(routePath) ||
			/^\/api\/v1\/listings\/[^/]+\/?$/i.test(routePath) ||
			/^\/profile\/?$/i.test(routePath) ||
			/^\/api\/v1\/users\/profile\/?$/i.test(routePath)
		);
	}
	return false;
}

function verifyMultipartCsrf(req) {
	const providedToken =
		req.get("x-csrf-token") ||
		req.get("x-xsrf-token") ||
		(req.body && typeof req.body._csrf === "string" ? req.body._csrf : "") ||
		(req.query && typeof req.query._csrf === "string" ? req.query._csrf : "");

	if (req.body && typeof req.body === "object" && "_csrf" in req.body) {
		delete req.body._csrf;
	}
	if (req.query && typeof req.query === "object" && "_csrf" in req.query) {
		delete req.query._csrf;
	}

	if (!req._pendingMultipartCsrf && !providedToken) {
		return true;
	}

	const sessionToken = req.session && req.session.csrfToken;
	return timingSafeCompare(providedToken, sessionToken);
}

function csrfProtection(req, res, next) {
	const method = (req.method || "GET").toUpperCase();

	if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
		const isStatelessEndpoint =
			req.path.startsWith("/api/") ||
			req.path === "/health" ||
			req.path === "/ready" ||
			req.path === "/notifications/unread-count";

		if (req.session && !isStatelessEndpoint && !req.session.csrfToken) {
			req.session.csrfToken = generateCsrfToken();
		}
		res.locals.csrfToken = (req.session && req.session.csrfToken) || "";

		// Prevent cross-site GET /logout via image/embed/navigation CSRF
		if (req.path === "/logout") {
			const secFetchDest = (req.get("sec-fetch-dest") || "").toLowerCase();
			if (
				!isOriginAllowed(req) ||
				(secFetchDest && !["document", "empty"].includes(secFetchDest))
			) {
				return sendCsrfFailure(req, res, "Cross-site logout request blocked.");
			}
		}

		return next();
	}

	res.locals.csrfToken = (req.session && req.session.csrfToken) || "";

	// Payment webhooks authenticate via cryptographic HMAC signatures over raw wire bytes
	if (req.originalUrl && req.originalUrl.startsWith("/api/v1/payments/webhook")) {
		return next();
	}

	if (!isOriginAllowed(req)) {
		return sendCsrfFailure(req, res, "Forbidden: Cross-site request blocked.");
	}

	const headerToken = req.get("x-csrf-token") || req.get("x-xsrf-token") || "";
	const bodyToken = req.body && typeof req.body._csrf === "string" ? req.body._csrf : "";
	const queryToken = req.query && typeof req.query._csrf === "string" ? req.query._csrf : "";
	const providedToken = headerToken || bodyToken || queryToken;

	if (req.body && typeof req.body === "object" && "_csrf" in req.body) {
		delete req.body._csrf;
	}
	if (req.query && typeof req.query === "object" && "_csrf" in req.query) {
		delete req.query._csrf;
	}

	const isMultipart = req.is && req.is("multipart/form-data");
	const browserContext = hasBrowserCsrfContext(req);

	if (isMultipart && !providedToken && isMultipartUploadRoute(req)) {
		req._pendingMultipartCsrf = browserContext;
		return next();
	}

	if (browserContext || providedToken) {
		const sessionToken = req.session && req.session.csrfToken;
		if (!timingSafeCompare(providedToken, sessionToken)) {
			return sendCsrfFailure(
				req,
				res,
				"Invalid or missing CSRF security token. Please refresh and try again.",
			);
		}
	}

	return next();
}

module.exports = {
	csrfProtection,
	verifyMultipartCsrf,
	generateCsrfToken,
};

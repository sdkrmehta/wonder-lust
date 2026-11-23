/**
 * Wander-Lust Security Sanitization Middleware
 * Defense against NoSQL query operator injection and stored XSS vectors.
 */

function cleanNoSql(obj) {
	if (!obj || typeof obj !== "object") return obj;

	if (Array.isArray(obj)) {
		return obj.map(cleanNoSql);
	}

	const cleaned = {};
	for (const key of Object.keys(obj)) {
		if (key.startsWith("$") || key.includes(".")) {
			continue; // Strip hazardous MongoDB operator keys
		}
		const val = obj[key];
		cleaned[key] = typeof val === "object" && val !== null ? cleanNoSql(val) : val;
	}
	return cleaned;
}

function cleanXss(obj) {
	if (!obj) return obj;
	if (typeof obj === "string") {
		return obj.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
	}
	if (Array.isArray(obj)) {
		return obj.map(cleanXss);
	}
	if (typeof obj === "object") {
		const result = {};
		for (const [k, v] of Object.entries(obj)) {
			result[k] = cleanXss(v);
		}
		return result;
	}
	return obj;
}

function sanitizeInput(req, res, next) {
	if (req.body) {
		req.body = cleanNoSql(cleanXss(req.body));
	}
	if (req.query) {
		req.query = cleanNoSql(cleanXss(req.query));
	}
	if (req.params) {
		req.params = cleanNoSql(cleanXss(req.params));
	}
	next();
}

module.exports = {
	sanitizeInput,
	cleanNoSql,
	cleanXss,
};

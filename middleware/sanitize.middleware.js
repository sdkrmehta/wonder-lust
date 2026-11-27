/**
 * Wonder-Lust Security Sanitization Middleware
 * Defense against NoSQL query operator injection and stored XSS vectors.
 */

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function cleanNoSql(obj) {
	if (!obj || typeof obj !== "object") return obj;

	if (Array.isArray(obj)) {
		return obj.map(cleanNoSql);
	}

	const cleaned = {};
	for (const key of Object.keys(obj)) {
		if (
			FORBIDDEN_KEYS.has(key) ||
			key.startsWith("$") ||
			key.includes(".")
		) {
			continue; // Strip MongoDB operators & prototype-pollution keys
		}
		const val = obj[key];
		cleaned[key] =
			typeof val === "object" && val !== null ? cleanNoSql(val) : val;
	}
	return cleaned;
}

function cleanXssString(input) {
	let current = input;
	let previous;
	do {
		previous = current;
		current = current
			.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
			.replace(/<\/?\s*(?:script|iframe|object|embed|svg|math|base|form)\b[^>]*>/gi, "")
			.replace(/\bon[a-z]{1,20}\s*=/gi, "")
			.replace(/\b(?:javascript|vbscript)\s*:/gi, "")
			.replace(/\bdata\s*:\s*text\/html\b/gi, "");
	} while (current !== previous);
	return current;
}

function cleanXss(obj) {
	if (!obj) return obj;
	if (typeof obj === "string") {
		return cleanXssString(obj);
	}
	if (Array.isArray(obj)) {
		return obj.map(cleanXss);
	}
	if (typeof obj === "object") {
		const result = {};
		for (const key of Object.keys(obj)) {
			if (FORBIDDEN_KEYS.has(key)) continue;
			result[key] = cleanXss(obj[key]);
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

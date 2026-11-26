const ExpressError = require("../utils/ExpressError");
const ApiResponse = require("../utils/apiResponse");
const env = require("../config/env");

// 404 Catch-All Handler
function notFoundHandler(req, res, next) {
	next(new ExpressError(404, "Page Not Found"));
}

// Global Centralized Error Handler
function errorHandler(err, req, res, next) {
	if (res.headersSent) {
		return next(err);
	}

	let { statusCode = 500, message = "Something went wrong" } = err;
	if (err.name === "CastError" && statusCode === 500) {
		statusCode = 400;
		message = "Invalid identifier format";
	} else if (err.name === "ValidationError" && statusCode === 500) {
		statusCode = 400;
	}

	const safeMessage =
		statusCode >= 500 && env.isProduction
			? "Internal server error. Please try again later."
			: message;
	const safeErrors = statusCode >= 500 && env.isProduction ? null : err.errors || null;

	if (statusCode >= 500) {
		console.error("[ERROR HANDLER]", {
			statusCode,
			path: req.originalUrl,
			method: req.method,
			message: err.message,
		});
	}

	// Distinguish between API requests and SSR browser requests
	const isApiRequest =
		req.originalUrl.startsWith("/api") ||
		(req.xhr && !req.accepts("html")) ||
		req.headers.accept === "application/json";

	if (isApiRequest) {
		return ApiResponse.error(res, safeMessage, statusCode, safeErrors);
	}

	res.status(statusCode).render("error.ejs", { message: safeMessage });
}

module.exports = {
	notFoundHandler,
	errorHandler,
};

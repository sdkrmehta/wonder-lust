const ExpressError = require("../utils/ExpressError");
const ApiResponse = require("../utils/apiResponse");

// 404 Catch-All Handler
function notFoundHandler(req, res, next) {
	next(new ExpressError(404, "Page Not Found"));
}

// Global Centralized Error Handler
function errorHandler(err, req, res, next) {
	let { statusCode = 500, message = "Something went wrong" } = err;

	// Distinguish between API requests and SSR browser requests
	const isApiRequest =
		req.originalUrl.startsWith("/api") ||
		(req.xhr && !req.accepts("html")) ||
		req.headers.accept === "application/json";

	if (isApiRequest) {
		return ApiResponse.error(res, message, statusCode, err.errors || null);
	}

	res.status(statusCode).render("error.ejs", { message });
}

module.exports = {
	notFoundHandler,
	errorHandler,
};

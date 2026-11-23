class AppError extends Error {
	constructor(statusCode, message) {
		super(message);
		this.statusCode = statusCode;
		this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
		this.isOperational = true;

		Error.captureStackTrace(this, this.constructor);
	}

	static badRequest(message = "Bad Request") {
		return new AppError(400, message);
	}

	static unauthorized(message = "Unauthorized. Please log in.") {
		return new AppError(401, message);
	}

	static forbidden(message = "Forbidden. You do not have permission.") {
		return new AppError(403, message);
	}

	static notFound(message = "Resource not found") {
		return new AppError(404, message);
	}

	static internal(message = "Internal Server Error") {
		return new AppError(500, message);
	}
}

module.exports = AppError;

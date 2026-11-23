class ApiResponse {
	static success(res, data = null, message = "Success", statusCode = 200) {
		return res.status(statusCode).json({
			success: true,
			status: "success",
			message,
			data,
		});
	}

	static created(res, data = null, message = "Resource created successfully") {
		return ApiResponse.success(res, data, message, 201);
	}

	static noContent(res) {
		return res.status(204).send();
	}

	static error(res, message = "An error occurred", statusCode = 500, errors = null) {
		const status = `${statusCode}`.startsWith("4") ? "fail" : "error";
		return res.status(statusCode).json({
			success: false,
			status,
			message,
			errors,
		});
	}
}

module.exports = ApiResponse;

const Joi = require("joi");

const signupSchema = Joi.object({
	username: Joi.string().trim().min(3).max(50).required().messages({
		"string.min": "Username must be at least 3 characters long",
		"string.max": "Username cannot exceed 50 characters",
		"any.required": "Username is required",
		"string.empty": "Username is required",
	}),
	email: Joi.string()
		.trim()
		.lowercase()
		.email({ tlds: { allow: false } })
		.required()
		.messages({
			"string.email": "Please provide a valid email address",
			"any.required": "Email is required",
			"string.empty": "Email is required",
		}),
	password: Joi.string().min(6).max(128).required().messages({
		"string.min": "Password must be at least 6 characters long",
		"string.max": "Password cannot exceed 128 characters",
		"any.required": "Password is required",
		"string.empty": "Password is required",
	}),
});

const profileFields = {
	fullName: Joi.string().allow("", null).max(100),
	bio: Joi.string().allow("", null).max(500),
	phone: Joi.string().allow("", null).max(20),
	address: Joi.string().allow("", null).max(200),
	city: Joi.string().allow("", null).max(100),
	country: Joi.string().allow("", null).max(100),
};

const profileUpdateSchema = Joi.object({
	user: Joi.object(profileFields).optional(),
	...profileFields,
});

const passwordChangeSchema = Joi.object({
	currentPassword: Joi.string().required().messages({
		"any.required": "Current password is required",
		"string.empty": "Current password is required",
	}),
	newPassword: Joi.string().min(6).max(128).required().messages({
		"string.min": "New password must be at least 6 characters long",
		"any.required": "New password is required",
		"string.empty": "New password is required",
	}),
	confirmPassword: Joi.string()
		.valid(Joi.ref("newPassword"))
		.required()
		.messages({
			"any.only": "Password confirmation does not match new password",
			"any.required": "Please confirm your new password",
			"string.empty": "Please confirm your new password",
		}),
});

module.exports = {
	signupSchema,
	profileUpdateSchema,
	passwordChangeSchema,
};

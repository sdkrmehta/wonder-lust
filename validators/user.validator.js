const Joi = require("joi");

const profileUpdateSchema = Joi.object({
	user: Joi.object({
		fullName: Joi.string().allow("", null).max(100),
		bio: Joi.string().allow("", null).max(500),
		phone: Joi.string().allow("", null).max(20),
		address: Joi.string().allow("", null).max(200),
		city: Joi.string().allow("", null).max(100),
		country: Joi.string().allow("", null).max(100),
	}).unknown(true),
}).unknown(true);

const passwordChangeSchema = Joi.object({
	currentPassword: Joi.string().required().messages({
		"any.required": "Current password is required",
		"string.empty": "Current password is required",
	}),
	newPassword: Joi.string().min(6).required().messages({
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
}).unknown(true);

module.exports = {
	profileUpdateSchema,
	passwordChangeSchema,
};

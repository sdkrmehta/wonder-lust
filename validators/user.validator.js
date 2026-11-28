const Joi = require("joi");
const { validatePostalCodeForCountry } = require("../utils/addressValidation");

const strongPasswordSchema = Joi.string()
	.min(8)
	.max(128)
	.pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/)
	.required()
	.messages({
		"string.min": "Password must be at least 8 characters long",
		"string.max": "Password cannot exceed 128 characters",
		"string.pattern.base":
			"Password must include at least one uppercase letter, one lowercase letter, and one number",
		"any.required": "Password is required",
		"string.empty": "Password is required",
	});

const signupSchema = Joi.object({
	fullName: Joi.string().trim().min(2).max(100).required().messages({
		"string.min": "Full name must be at least 2 characters long",
		"string.max": "Full name cannot exceed 100 characters",
		"any.required": "Full name is required",
		"string.empty": "Full name is required",
	}),
	username: Joi.string()
		.trim()
		.min(3)
		.max(50)
		.pattern(/^[a-zA-Z0-9_.-]+$/)
		.allow("", null)
		.optional()
		.messages({
			"string.min": "Username must be at least 3 characters long",
			"string.max": "Username cannot exceed 50 characters",
			"string.pattern.base":
				"Username may only contain letters, numbers, dots, underscores, and hyphens",
		}),
	email: Joi.string()
		.trim()
		.lowercase()
		.email({ tlds: { allow: false } })
		.required()
		.messages({
			"string.email": "Please provide a valid email address",
			"any.required": "Email address is required",
			"string.empty": "Email address is required",
		}),
	password: strongPasswordSchema,
	confirmPassword: Joi.string()
		.valid(Joi.ref("password"))
		.required()
		.messages({
			"any.only": "Password and confirm password do not match",
			"any.required": "Please confirm your password",
			"string.empty": "Please confirm your password",
		}),
	phone: Joi.string().trim().allow("", null).max(25).optional(),
	addressLine1: Joi.string().trim().min(3).max(200).required().messages({
		"string.min": "Address Line 1 must be at least 3 characters long",
		"string.max": "Address Line 1 cannot exceed 200 characters",
		"any.required": "Address Line 1 is required",
		"string.empty": "Address Line 1 is required",
	}),
	addressLine2: Joi.string().trim().allow("", null).max(200).optional(),
	landmark: Joi.string().trim().allow("", null).max(150).optional(),
	city: Joi.string().trim().min(2).max(100).required().messages({
		"string.min": "City must be at least 2 characters long",
		"string.max": "City cannot exceed 100 characters",
		"any.required": "City is required",
		"string.empty": "City is required",
	}),
	state: Joi.string().trim().min(2).max(100).required().messages({
		"string.min": "State must be at least 2 characters long",
		"string.max": "State cannot exceed 100 characters",
		"any.required": "State is required",
		"string.empty": "State is required",
	}),
	country: Joi.string().trim().min(2).max(100).default("India").messages({
		"string.min": "Please select a valid country",
		"any.required": "Country is required",
		"string.empty": "Country is required",
	}),
	postalCode: Joi.string()
		.trim()
		.required()
		.custom((value, helpers) => {
			const country = helpers.state.ancestors[0]?.country || "India";
			const check = validatePostalCodeForCountry(value, country);
			if (!check.valid) {
				return helpers.message(check.message);
			}
			return check.value;
		})
		.messages({
			"any.required": "PIN Code / Postal Code is required",
			"string.empty": "PIN Code / Postal Code is required",
		}),
	termsAccepted: Joi.valid(true, "true", "on", "yes", "1").required().messages({
		"any.only": "You must accept the Terms of Service and Privacy Policy",
		"any.required": "You must accept the Terms of Service and Privacy Policy",
	}),
});

const verifyEmailOtpSchema = Joi.object({
	email: Joi.string()
		.trim()
		.lowercase()
		.email({ tlds: { allow: false } })
		.required()
		.messages({
			"string.email": "Please provide a valid email address",
			"any.required": "Email address is required",
			"string.empty": "Email address is required",
		}),
	otp: Joi.string()
		.trim()
		.pattern(/^\d{6}$/)
		.required()
		.messages({
			"string.pattern.base": "Please enter a valid 6-digit verification code",
			"any.required": "Verification code is required",
			"string.empty": "Verification code is required",
		}),
});

const resendOtpSchema = Joi.object({
	email: Joi.string()
		.trim()
		.lowercase()
		.email({ tlds: { allow: false } })
		.required()
		.messages({
			"string.email": "Please provide a valid email address",
			"any.required": "Email address is required",
			"string.empty": "Email address is required",
		}),
});

function validateConditionalAddress(obj, helpers) {
	if (!obj || typeof obj !== "object") return obj;
	if ("email" in obj || "emailVerified" in obj || "role" in obj || "isSuperhost" in obj) {
		return helpers.message("Protected account fields (such as login email) cannot be modified here");
	}
	const hasAddressMutation =
		"addressLine1" in obj || "state" in obj || "postalCode" in obj;
	if (hasAddressMutation) {
		if (typeof obj.addressLine1 === "string" && obj.addressLine1.trim().length < 3) {
			return helpers.message("Address Line 1 must be at least 3 characters long");
		}
		if (typeof obj.city === "string" && obj.city.trim().length < 2) {
			return helpers.message("City must be at least 2 characters long");
		}
		if (typeof obj.state === "string" && obj.state.trim().length < 2) {
			return helpers.message("State must be at least 2 characters long");
		}
		if ("postalCode" in obj) {
			const country = obj.country || "India";
			const check = validatePostalCodeForCountry(obj.postalCode || "", country);
			if (!check.valid) {
				return helpers.message(check.message);
			}
			obj.postalCode = check.value;
		}
	}
	return obj;
}

const profileFields = {
	fullName: Joi.string().trim().min(2).max(100).messages({
		"string.min": "Full name must be at least 2 characters long",
		"string.empty": "Full name cannot be empty",
	}),
	bio: Joi.string().allow("", null).max(500),
	phone: Joi.string().allow("", null).max(25),
	addressLine1: Joi.string().trim().allow("", null).max(200),
	addressLine2: Joi.string().trim().allow("", null).max(200),
	landmark: Joi.string().trim().allow("", null).max(150),
	address: Joi.string().trim().allow("", null).max(250),
	city: Joi.string().trim().allow("", null).max(100),
	state: Joi.string().trim().allow("", null).max(100),
	postalCode: Joi.string().trim().allow("", null).max(20),
	country: Joi.string().trim().allow("", null).max(100),
};

const profileUpdateSchema = Joi.object({
	user: Joi.object(profileFields).custom(validateConditionalAddress).optional(),
	...profileFields,
}).custom(validateConditionalAddress);

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
	verifyEmailOtpSchema,
	resendOtpSchema,
	profileUpdateSchema,
	passwordChangeSchema,
};

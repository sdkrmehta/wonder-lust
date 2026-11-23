const Joi = require("joi");

const paymentSchema = Joi.object({
	paymentMethod: Joi.string()
		.valid("card", "upi", "netbanking", "wallet")
		.default("card"),
	cardNumber: Joi.string()
		.allow("", null)
		.custom((value, helpers) => {
			if (!value) return value;
			const cleaned = value.replace(/\s+/g, "");
			if (!/^\d{15,19}$/.test(cleaned)) {
				return helpers.error("string.pattern.base", { value });
			}
			return cleaned;
		})
		.messages({
			"string.pattern.base": "Please provide a valid 16-digit card number",
		}),
	cardExpiry: Joi.string().allow("", null),
	cardCvc: Joi.string().allow("", null),
	cardHolderName: Joi.string().allow("", null),
	upiId: Joi.string().allow("", null),
	bankName: Joi.string().allow("", null),
	billingDetails: Joi.object({
		fullName: Joi.string().allow("", null),
		email: Joi.string().email({ tlds: { allow: false } }).allow("", null),
		phone: Joi.string().allow("", null),
		address: Joi.string().allow("", null),
		city: Joi.string().allow("", null),
		state: Joi.string().allow("", null),
		postalCode: Joi.string().allow("", null),
		country: Joi.string().default("India"),
	}).optional(),
}).unknown(true);

module.exports = {
	paymentSchema,
};

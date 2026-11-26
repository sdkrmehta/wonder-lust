const Joi = require("joi");

const paymentSchema = Joi.object({
	bookingId: Joi.string().optional(),
	requireWebhookConfirmation: Joi.boolean().optional(),
	paymentMethod: Joi.string()
		.valid("card", "upi", "netbanking", "wallet")
		.default("card"),
	amount: Joi.number().min(0).optional(),
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
	cardExpiry: Joi.string().allow("", null).max(10),
	cardCvc: Joi.string().allow("", null).max(6),
	cardHolderName: Joi.string().allow("", null).max(120),
	upiId: Joi.string().allow("", null).max(100),
	bankName: Joi.string().allow("", null).max(100),
	billingDetails: Joi.object({
		fullName: Joi.string().allow("", null).max(120),
		email: Joi.string().email({ tlds: { allow: false } }).allow("", null),
		phone: Joi.string().allow("", null).max(25),
		address: Joi.string().allow("", null).max(250),
		city: Joi.string().allow("", null).max(100),
		state: Joi.string().allow("", null).max(100),
		postalCode: Joi.string().allow("", null).max(20),
		country: Joi.string().default("India").max(100),
	}).optional(),
});

const razorpayVerifySchema = Joi.object({
	bookingId: Joi.string().optional(),
	razorpay_order_id: Joi.string().trim().min(5).max(120).required(),
	razorpay_payment_id: Joi.string().trim().min(5).max(120).required(),
	razorpay_signature: Joi.string()
		.trim()
		.pattern(/^[a-f0-9]{64}$/i)
		.required(),
});

module.exports = {
	paymentSchema,
	razorpayVerifySchema,
};

const Joi = require("joi");
const { validatePostalCodeForCountry } = require("../utils/addressValidation");

const billingDetailsSchema = Joi.object({
	fullName: Joi.string().trim().min(2).max(120).required().messages({
		"string.min": "Billing full name must be at least 2 characters long",
		"any.required": "Billing full name is required",
		"string.empty": "Billing full name is required",
	}),
	email: Joi.string()
		.trim()
		.lowercase()
		.email({ tlds: { allow: false } })
		.required()
		.messages({
			"string.email": "Please provide a valid billing email address",
			"any.required": "Billing email address is required",
			"string.empty": "Billing email address is required",
		}),
	phone: Joi.string().trim().allow("", null).max(25).optional(),
	addressLine1: Joi.string().trim().min(3).max(200).optional(),
	addressLine2: Joi.string().trim().allow("", null).max(200).optional(),
	landmark: Joi.string().trim().allow("", null).max(150).optional(),
	address: Joi.string().trim().allow("", null).max(250).optional(),
	city: Joi.string().trim().min(2).max(100).required().messages({
		"string.min": "Billing city must be at least 2 characters long",
		"any.required": "Billing city is required",
		"string.empty": "Billing city is required",
	}),
	state: Joi.string().trim().min(2).max(100).required().messages({
		"string.min": "Billing state must be at least 2 characters long",
		"any.required": "Billing state is required",
		"string.empty": "Billing state is required",
	}),
	country: Joi.string().trim().min(2).max(100).default("India").messages({
		"string.min": "Please select a valid billing country",
		"any.required": "Billing country is required",
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
			"any.required": "Billing PIN / postal code is required",
			"string.empty": "Billing PIN / postal code is required",
		}),
}).custom((obj, helpers) => {
	const line1 = String(obj.addressLine1 || obj.address || "").trim();
	if (line1.length < 3) {
		return helpers.message("Billing Address Line 1 must be at least 3 characters long");
	}
	obj.addressLine1 = line1;
	return obj;
});

const paymentSchema = Joi.object({
	bookingId: Joi.string().optional(),
	requireWebhookConfirmation: Joi.boolean().optional(),
	saveAsDefaultAddress: Joi.alternatives()
		.try(Joi.boolean(), Joi.string().valid("true", "false", "on", "1", "0", ""))
		.optional(),
	paymentMethod: Joi.string()
		.valid("card", "upi", "netbanking", "wallet", "razorpay_payment_link")
		.default("razorpay_payment_link"),
	amount: Joi.number().min(0).optional(),
	cardNumber: Joi.string().allow("", null).max(25).optional(),
	cardExpiry: Joi.string().allow("", null).max(10).optional(),
	cardCvc: Joi.string().allow("", null).max(6).optional(),
	cardHolderName: Joi.string().allow("", null).max(120).optional(),
	upiId: Joi.string().allow("", null).max(100).optional(),
	bankName: Joi.string().allow("", null).max(100).optional(),
	billingDetails: billingDetailsSchema.optional(),
});

const checkoutPaymentLinkSchema = Joi.object({
	bookingId: Joi.string().optional(),
	amount: Joi.number().min(0).optional(),
	saveAsDefaultAddress: Joi.alternatives()
		.try(Joi.boolean(), Joi.string().valid("true", "false", "on", "1", "0", ""))
		.optional(),
	billingDetails: billingDetailsSchema.required().messages({
		"any.required": "Billing address details are required to proceed to payment",
	}),
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

const razorpayPaymentLinkCallbackSchema = Joi.object({
	razorpay_payment_id: Joi.string().trim().max(120).allow("", null).optional(),
	razorpay_payment_link_id: Joi.string().trim().min(5).max(120).required(),
	razorpay_payment_link_reference_id: Joi.string().trim().min(3).max(120).required(),
	razorpay_payment_link_status: Joi.string()
		.trim()
		.valid("created", "partially_paid", "paid", "cancelled", "expired")
		.required(),
	razorpay_signature: Joi.string().trim().max(128).allow("", null).optional(),
});

module.exports = {
	billingDetailsSchema,
	paymentSchema,
	checkoutPaymentLinkSchema,
	razorpayVerifySchema,
	razorpayPaymentLinkCallbackSchema,
};

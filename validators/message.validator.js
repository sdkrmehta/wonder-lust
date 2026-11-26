const Joi = require("joi");

const sendMessageSchema = Joi.object({
	body: Joi.string().required().trim().min(1).max(2000).messages({
		"string.empty": "Message text cannot be empty",
		"any.required": "Message text is required",
	}),
	recipientId: Joi.string().optional(),
	listingId: Joi.string().optional(),
});

const inquirySchema = Joi.object({
	listingId: Joi.string().optional(),
	message: Joi.string().allow("", null).max(2000),
	body: Joi.string().allow("", null).max(2000),
	checkIn: Joi.date().iso().allow("", null).optional(),
	checkOut: Joi.date().iso().allow("", null).optional(),
	guests: Joi.number().min(1).max(50).optional(),
});

module.exports = {
	sendMessageSchema,
	inquirySchema,
};

const Joi = require("joi");

const sendMessageSchema = Joi.object({
	body: Joi.string().required().trim().min(1).max(2000).messages({
		"string.empty": "Message text cannot be empty",
		"any.required": "Message text is required",
	}),
	recipientId: Joi.string().optional(),
	listingId: Joi.string().optional(),
}).unknown(true);

const inquirySchema = Joi.object({
	message: Joi.string().allow("", null).max(2000),
	checkIn: Joi.date().iso().optional(),
	checkOut: Joi.date().iso().optional(),
	guests: Joi.number().optional(),
}).unknown(true);

module.exports = {
	sendMessageSchema,
	inquirySchema,
};

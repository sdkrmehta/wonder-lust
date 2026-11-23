const Joi = require("joi");

const bookingSchema = Joi.object({
	booking: Joi.object({
		checkIn: Joi.date().iso().required().messages({
			"date.base": "Please provide a valid check-in date",
			"any.required": "Check-in date is required",
		}),
		checkOut: Joi.date().iso().greater(Joi.ref("checkIn")).required().messages({
			"date.base": "Please provide a valid check-out date",
			"date.greater": "Check-out date must be after check-in date",
			"any.required": "Check-out date is required",
		}),
		guests: Joi.number().integer().min(1).default(1).messages({
			"number.base": "Guests must be a valid number",
			"number.min": "At least 1 guest is required",
		}),
	}).required(),
});

module.exports = {
	bookingSchema,
};

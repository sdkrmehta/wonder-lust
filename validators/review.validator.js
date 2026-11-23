const Joi = require("joi");

const reviewSchema = Joi.object({
	review: Joi.object({
		rating: Joi.number().required().min(1).max(5).messages({
			"number.base": "Rating must be a number",
			"number.min": "Rating must be at least 1 star",
			"number.max": "Rating cannot exceed 5 stars",
			"any.required": "Rating is required",
		}),
		comment: Joi.string().required().trim().messages({
			"string.empty": "Review comment cannot be empty",
			"any.required": "Review comment is required",
		}),
		cleanliness: Joi.number().min(1).max(5).default(5),
		accuracy: Joi.number().min(1).max(5).default(5),
		communication: Joi.number().min(1).max(5).default(5),
		location: Joi.number().min(1).max(5).default(5),
		checkIn: Joi.number().min(1).max(5).default(5),
		value: Joi.number().min(1).max(5).default(5),
	}).required(),
});

const hostReplySchema = Joi.object({
	comment: Joi.string().required().trim().min(2).max(1000).messages({
		"string.empty": "Host reply cannot be empty",
		"any.required": "Host reply is required",
	}),
});

const flagReviewSchema = Joi.object({
	reason: Joi.string().required().trim().min(2).max(500).messages({
		"string.empty": "Reason for reporting is required",
		"any.required": "Reason is required",
	}),
});

module.exports = {
	reviewSchema,
	hostReplySchema,
	flagReviewSchema,
};

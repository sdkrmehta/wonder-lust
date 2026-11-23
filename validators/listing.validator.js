const Joi = require("joi");

const listingSchema = Joi.object({
	listing: Joi.object({
		title: Joi.string().required().trim().messages({
			"string.empty": "Listing title is required",
			"any.required": "Listing title is required",
		}),
		description: Joi.string().required().trim().messages({
			"string.empty": "Listing description is required",
			"any.required": "Listing description is required",
		}),
		location: Joi.string().required().trim().messages({
			"string.empty": "Location is required",
			"any.required": "Location is required",
		}),
		country: Joi.string().required().trim().messages({
			"string.empty": "Country is required",
			"any.required": "Country is required",
		}),
		price: Joi.number().required().min(0).messages({
			"number.base": "Price must be a valid number",
			"number.min": "Price must be greater than or equal to 0",
			"any.required": "Price is required",
		}),
		category: Joi.string().allow("", null),
		propertyType: Joi.string().allow("", null),
		status: Joi.string().valid("published", "draft", "archived").default("published"),
		bedrooms: Joi.number().min(0).optional(),
		bathrooms: Joi.number().min(0).optional(),
		guests: Joi.number().min(1).optional(),
		amenities: Joi.alternatives()
			.try(Joi.array().items(Joi.string()), Joi.string())
			.optional(),
		image: Joi.alternatives()
			.try(
				Joi.string().allow("", null),
				Joi.object({
					url: Joi.string().allow("", null),
					filename: Joi.string().allow("", null),
				}).allow(null),
			)
			.optional(),
		images: Joi.array()
			.items(
				Joi.object({
					_id: Joi.any().optional(),
					url: Joi.string().required(),
					filename: Joi.string().allow("", null).optional(),
					isPrimary: Joi.boolean().optional(),
				}),
			)
			.optional(),
		geometry: Joi.object({
			type: Joi.string().valid("Point").optional(),
			coordinates: Joi.array().items(Joi.number()).length(2).optional(),
		}).optional(),
	}).required(),
});

module.exports = {
	listingSchema,
};

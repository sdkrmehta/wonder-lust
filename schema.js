// Backward-compatibility export pointing to modular validators
const { listingSchema, reviewSchema } = require("./validators");

module.exports = {
	listingSchema,
	reviewSchema,
};

const { listingSchema } = require("./listing.validator");
const {
	reviewSchema,
	hostReplySchema,
	flagReviewSchema,
} = require("./review.validator");
const { bookingSchema } = require("./booking.validator");
const { paymentSchema } = require("./payment.validator");
const { profileUpdateSchema, passwordChangeSchema } = require("./user.validator");

const {
	sendMessageSchema,
	inquirySchema,
} = require("./message.validator");

module.exports = {
	listingSchema,
	reviewSchema,
	hostReplySchema,
	flagReviewSchema,
	bookingSchema,
	paymentSchema,
	profileUpdateSchema,
	passwordChangeSchema,
	sendMessageSchema,
	inquirySchema,
};

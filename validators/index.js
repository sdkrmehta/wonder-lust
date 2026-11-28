const { listingSchema } = require("./listing.validator");
const {
	reviewSchema,
	hostReplySchema,
	flagReviewSchema,
} = require("./review.validator");
const { bookingSchema } = require("./booking.validator");
const {
	billingDetailsSchema,
	paymentSchema,
	checkoutPaymentLinkSchema,
	razorpayVerifySchema,
	razorpayPaymentLinkCallbackSchema,
} = require("./payment.validator");
const {
	signupSchema,
	verifyEmailOtpSchema,
	resendOtpSchema,
	profileUpdateSchema,
	passwordChangeSchema,
} = require("./user.validator");

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
	billingDetailsSchema,
	paymentSchema,
	checkoutPaymentLinkSchema,
	razorpayVerifySchema,
	razorpayPaymentLinkCallbackSchema,
	signupSchema,
	verifyEmailOtpSchema,
	resendOtpSchema,
	profileUpdateSchema,
	passwordChangeSchema,
	sendMessageSchema,
	inquirySchema,
};

const {
	listingSchema,
	reviewSchema,
	hostReplySchema,
	flagReviewSchema,
	bookingSchema,
	paymentSchema,
	signupSchema,
	profileUpdateSchema,
	passwordChangeSchema,
	sendMessageSchema,
	inquirySchema,
} = require("../validators");
const ExpressError = require("../utils/ExpressError");
const { cleanupRequestUploads } = require("../config/storage");

module.exports.validateSignup = (req, res, next) => {
	const { error } = signupSchema.validate(req.body);
	if (error) {
		const errMsg = error.details.map((el) => el.message).join(", ");
		throw new ExpressError(400, errMsg);
	}
	next();
};

module.exports.validateListing = (req, res, next) => {
	const { error } = listingSchema.validate(req.body);
	if (error) {
		cleanupRequestUploads(req);
		const errMsg = error.details.map((el) => el.message).join(", ");
		throw new ExpressError(400, errMsg);
	}
	next();
};

module.exports.validateReview = (req, res, next) => {
	const { error } = reviewSchema.validate(req.body);
	if (error) {
		const errMsg = error.details.map((el) => el.message).join(", ");
		throw new ExpressError(400, errMsg);
	}
	next();
};

module.exports.validateHostReply = (req, res, next) => {
	const { error } = hostReplySchema.validate(req.body);
	if (error) {
		const errMsg = error.details.map((el) => el.message).join(", ");
		throw new ExpressError(400, errMsg);
	}
	next();
};

module.exports.validateFlagReview = (req, res, next) => {
	const { error } = flagReviewSchema.validate(req.body);
	if (error) {
		const errMsg = error.details.map((el) => el.message).join(", ");
		throw new ExpressError(400, errMsg);
	}
	next();
};

module.exports.validateBooking = (req, res, next) => {
	const { error } = bookingSchema.validate(req.body);
	if (error) {
		const errMsg = error.details.map((el) => el.message).join(", ");
		throw new ExpressError(400, errMsg);
	}
	next();
};

module.exports.validatePayment = (req, res, next) => {
	const { error } = paymentSchema.validate(req.body);
	if (error) {
		const errMsg = error.details.map((el) => el.message).join(", ");
		throw new ExpressError(400, errMsg);
	}
	next();
};

module.exports.validateProfileUpdate = (req, res, next) => {
	const { error } = profileUpdateSchema.validate(req.body);
	if (error) {
		cleanupRequestUploads(req);
		const errMsg = error.details.map((el) => el.message).join(", ");
		throw new ExpressError(400, errMsg);
	}
	next();
};

module.exports.validatePasswordChange = (req, res, next) => {
	const { error } = passwordChangeSchema.validate(req.body);
	if (error) {
		const errMsg = error.details.map((el) => el.message).join(", ");
		throw new ExpressError(400, errMsg);
	}
	next();
};

module.exports.validateSendMessage = (req, res, next) => {
	const { error } = sendMessageSchema.validate(req.body);
	if (error) {
		const errMsg = error.details.map((el) => el.message).join(", ");
		throw new ExpressError(400, errMsg);
	}
	next();
};

module.exports.validateInquiry = (req, res, next) => {
	const { error } = inquirySchema.validate(req.body);
	if (error) {
		const errMsg = error.details.map((el) => el.message).join(", ");
		throw new ExpressError(400, errMsg);
	}
	next();
};

const {
	listingSchema,
	reviewSchema,
	hostReplySchema,
	flagReviewSchema,
	bookingSchema,
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
} = require("../validators");
const ExpressError = require("../utils/ExpressError");
const { cleanupRequestUploads } = require("../config/storage");
const { SUPPORTED_COUNTRIES } = require("../utils/addressValidation");
const { isJsonOrBackgroundRequest } = require("./auth.middleware");

module.exports.validateSignup = (req, res, next) => {
	const { error, value } = signupSchema.validate(req.body, { abortEarly: false });
	if (error) {
		const errMsg = error.details.map((el) => el.message).join(", ");
		if (isJsonOrBackgroundRequest(req)) {
			throw new ExpressError(400, errMsg);
		}
		const safeFormData = {
			fullName: typeof req.body?.fullName === "string" ? req.body.fullName : "",
			email: typeof req.body?.email === "string" ? req.body.email : "",
			username: typeof req.body?.username === "string" ? req.body.username : "",
			addressLine1: typeof req.body?.addressLine1 === "string" ? req.body.addressLine1 : "",
			addressLine2: typeof req.body?.addressLine2 === "string" ? req.body.addressLine2 : "",
			landmark: typeof req.body?.landmark === "string" ? req.body.landmark : "",
			city: typeof req.body?.city === "string" ? req.body.city : "",
			state: typeof req.body?.state === "string" ? req.body.state : "",
			postalCode: typeof req.body?.postalCode === "string" ? req.body.postalCode : "",
			country: typeof req.body?.country === "string" && req.body.country ? req.body.country : "India",
			termsAccepted: Boolean(req.body?.termsAccepted),
		};
		return res.status(400).render("users/signup.ejs", {
			formData: safeFormData,
			countries: SUPPORTED_COUNTRIES,
			error: [errMsg],
		});
	}
	req.body = value;
	next();
};

module.exports.validateVerifyEmailOtp = (req, res, next) => {
	const merged = {
		...req.body,
		email: req.body?.email || req.session?.pendingVerificationEmail || "",
	};
	const { error, value } = verifyEmailOtpSchema.validate(merged, { abortEarly: false });
	if (error) {
		const errMsg = error.details.map((el) => el.message).join(", ");
		if (isJsonOrBackgroundRequest(req)) {
			throw new ExpressError(400, errMsg);
		}
		return res.status(400).render("users/verify-email.ejs", {
			email: merged.email,
			cooldownSeconds: 0,
			ttlMinutes: 5,
			error: [errMsg],
		});
	}
	req.body = value;
	next();
};

module.exports.validateResendOtp = (req, res, next) => {
	const merged = {
		...req.body,
		email: req.body?.email || req.session?.pendingVerificationEmail || "",
	};
	const { error, value } = resendOtpSchema.validate(merged, { abortEarly: false });
	if (error) {
		const errMsg = error.details.map((el) => el.message).join(", ");
		if (isJsonOrBackgroundRequest(req)) {
			throw new ExpressError(400, errMsg);
		}
		return res.status(400).render("users/verify-email.ejs", {
			email: merged.email,
			cooldownSeconds: 0,
			ttlMinutes: 5,
			error: [errMsg],
		});
	}
	req.body = value;
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
	const { error, value } = paymentSchema.validate(req.body, { abortEarly: false });
	if (error) {
		const errMsg = error.details.map((el) => el.message).join(", ");
		throw new ExpressError(400, errMsg);
	}
	req.body = value;
	next();
};

module.exports.validateCheckoutPaymentLink = (req, res, next) => {
	const { error, value } = checkoutPaymentLinkSchema.validate(req.body, { abortEarly: false });
	if (error) {
		const errMsg = error.details.map((el) => el.message).join(", ");
		if (isJsonOrBackgroundRequest(req) || !req.params?.bookingId) {
			throw new ExpressError(400, errMsg);
		}
		req.flash("error", errMsg);
		return res.redirect(`/payments/checkout/${req.params.bookingId}`);
	}
	req.body = value;
	next();
};

module.exports.validateRazorpayVerify = (req, res, next) => {
	const { error, value } = razorpayVerifySchema.validate(req.body, { abortEarly: false });
	if (error) {
		const errMsg = error.details.map((el) => el.message).join(", ");
		throw new ExpressError(400, errMsg);
	}
	req.body = value;
	next();
};

module.exports.validateRazorpayPaymentLinkCallback = (req, res, next) => {
	const source = req.method === "GET" ? req.query : req.body;
	const { error, value } = razorpayPaymentLinkCallbackSchema.validate(source, { abortEarly: false });
	if (error) {
		const errMsg = error.details.map((el) => el.message).join(", ");
		throw new ExpressError(400, errMsg);
	}
	if (req.method === "GET") {
		req.query = value;
	} else {
		req.body = value;
	}
	next();
};

module.exports.validateProfileUpdate = (req, res, next) => {
	const { error, value } = profileUpdateSchema.validate(req.body, { abortEarly: false });
	if (error) {
		cleanupRequestUploads(req);
		const errMsg = error.details.map((el) => el.message).join(", ");
		if (isJsonOrBackgroundRequest(req)) {
			throw new ExpressError(400, errMsg);
		}
		const submitted =
			req.body && typeof req.body.user === "object" && req.body.user !== null
				? req.body.user
				: req.body || {};
		const mergedUser = {
			...(req.user && typeof req.user.toObject === "function" ? req.user.toObject() : req.user || {}),
			...submitted,
			email: req.user?.email || "",
			username: req.user?.username || "",
		};
		return res.status(400).render("users/edit.ejs", {
			user: mergedUser,
			countries: SUPPORTED_COUNTRIES,
			error: [errMsg],
		});
	}
	req.body = value;
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

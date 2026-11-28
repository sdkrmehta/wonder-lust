const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const paymentSchema = new Schema(
	{
		booking: {
			type: Schema.Types.ObjectId,
			ref: "Booking",
			required: [true, "Booking reference is required"],
		},
		user: {
			type: Schema.Types.ObjectId,
			ref: "User",
			required: [true, "User reference is required"],
		},
		transactionId: {
			type: String,
			required: [true, "Transaction ID is required"],
		},
		orderId: {
			type: String,
			required: [true, "Order ID is required"],
		},
		receiptNumber: {
			type: String,
			required: [true, "Receipt number is required"],
			unique: true,
		},
		amount: {
			type: Number,
			required: [true, "Payment amount is required"],
			min: [0, "Amount cannot be negative"],
		},
		currency: {
			type: String,
			default: "INR",
			uppercase: true,
		},
		paymentMethod: {
			type: String,
			enum: ["card", "upi", "netbanking", "wallet", "emi", "bank_transfer", "razorpay_payment_link"],
			default: "card",
		},
		status: {
			type: String,
			enum: ["pending", "created", "paid", "succeeded", "failed", "cancelled", "expired", "refunded"],
			default: "succeeded",
		},
		gateway: {
			type: String,
			default: "wonderlust_pay",
		},
		gatewayStatus: {
			type: String,
			default: null,
		},
		gatewayOrderId: {
			type: String,
			default: null,
		},
		gatewayPaymentId: {
			type: String,
			default: null,
		},
		paymentLinkId: {
			type: String,
			default: null,
		},
		paymentLinkReferenceId: {
			type: String,
			default: null,
		},
		paymentLinkShortUrl: {
			type: String,
			default: null,
		},
		paymentLinkStatus: {
			type: String,
			enum: ["created", "partially_paid", "paid", "cancelled", "expired", null],
			default: null,
		},
		paymentLinkExpiresAt: {
			type: Date,
			default: null,
		},
		webhookVerified: {
			type: Boolean,
			default: false,
		},
		webhookEventId: {
			type: String,
			default: null,
		},
		processedWebhookEvents: {
			type: [String],
			default: [],
		},
		gatewaySignatureVerifiedAt: {
			type: Date,
			default: null,
		},
		cardDetails: {
			brand: { type: String, default: "Visa" },
			last4: { type: String, default: "4242" },
			expiry: { type: String, default: "12/28" },
		},
		upiDetails: {
			vpa: { type: String },
		},
		netbankingDetails: {
			bankName: { type: String },
		},
		billingDetails: {
			fullName: { type: String, trim: true },
			email: { type: String, trim: true, lowercase: true },
			phone: { type: String, trim: true },
			addressLine1: { type: String, trim: true },
			addressLine2: { type: String, trim: true },
			landmark: { type: String, trim: true },
			address: { type: String, trim: true },
			city: { type: String, trim: true },
			state: { type: String, trim: true },
			postalCode: { type: String, trim: true },
			country: { type: String, default: "India" },
		},
		refundId: {
			type: String,
		},
		refundAmount: {
			type: Number,
			default: 0,
		},
		refundReason: {
			type: String,
		},
		refundedAt: {
			type: Date,
		},
	},
	{ timestamps: true },
);

// Indexes for rapid lookups and reporting
paymentSchema.index({ transactionId: 1 }, { unique: true });
paymentSchema.index({ orderId: 1 }, { unique: true });
paymentSchema.index({ gatewayOrderId: 1 }, { sparse: true });
paymentSchema.index({ gatewayPaymentId: 1 }, { sparse: true });
paymentSchema.index({ paymentLinkId: 1 }, { sparse: true });
paymentSchema.index({ paymentLinkReferenceId: 1 }, { sparse: true });
paymentSchema.index({ booking: 1 });
paymentSchema.index({ booking: 1, status: 1 });
paymentSchema.index({ user: 1, createdAt: -1 });
paymentSchema.index({ status: 1, createdAt: -1 });

const Payment = mongoose.model("Payment", paymentSchema);
module.exports = Payment;

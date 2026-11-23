const crypto = require("crypto");
const mongoose = require("mongoose");
const Payment = require("../models/payment");
const Booking = require("../models/booking");
const Listing = require("../models/listing");
const AppError = require("../utils/AppError");

class PaymentService {
	/**
	 * Detect card brand from card number digits.
	 */
	static detectCardBrand(cardNumber) {
		if (!cardNumber) return "Visa";
		const cleaned = cardNumber.replace(/\D/g, "");
		if (/^4/.test(cleaned)) return "Visa";
		if (/^(5[1-5]|2[2-7])/.test(cleaned)) return "MasterCard";
		if (/^(60|65|81|82)/.test(cleaned)) return "RuPay";
		if (/^3[47]/.test(cleaned)) return "American Express";
		return "Card";
	}

	/**
	 * Create an authorized payment order and mark booking as confirmed & paid.
	 */
	static async createPaymentOrder(bookingId, paymentData = {}, user) {
		if (!mongoose.Types.ObjectId.isValid(bookingId)) {
			throw AppError.notFound("Invalid booking ID format");
		}

		const booking = await Booking.findById(bookingId).populate("listing");
		if (!booking) {
			throw AppError.notFound("Booking not found");
		}

		// Authorization check: only booking owner or admin can pay
		if (user && String(booking.user) !== String(user._id)) {
			throw AppError.forbidden("You are not authorized to pay for this booking");
		}

		if (booking.status === "cancelled") {
			throw AppError.badRequest("Cannot process payment for a cancelled booking");
		}

		// Check if already paid
		const existingPayment = await Payment.findOne({
			booking: booking._id,
			status: "succeeded",
		});
		if (existingPayment) {
			throw AppError.badRequest("This booking has already been paid for");
		}

		// Amount verification
		const requestedAmount = Number(paymentData.amount);
		if (requestedAmount && requestedAmount !== booking.totalPrice) {
			throw AppError.badRequest(
				`Payment amount ₹${requestedAmount} does not match booking total ₹${booking.totalPrice}`,
			);
		}

		const paymentMethod = paymentData.paymentMethod || "card";

		// Generate secure transaction & order IDs
		const randomHex = crypto.randomBytes(4).toString("hex");
		const transactionId = `txn_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
		const orderId = `order_${Date.now()}_${randomHex}`;
		const receiptNumber = `INV-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

		// Extract card or UPI details
		const cardDetails = {};
		const upiDetails = {};
		const netbankingDetails = {};

		if (paymentMethod === "card") {
			const rawCard = String(paymentData.cardNumber || "4111111111114242").replace(/\D/g, "");
			cardDetails.last4 = rawCard.slice(-4) || "4242";
			cardDetails.brand = this.detectCardBrand(rawCard);
			cardDetails.expiry = paymentData.cardExpiry || "12/28";
		} else if (paymentMethod === "upi") {
			upiDetails.vpa = paymentData.upiId || "traveler@okhdfcbank";
		} else if (paymentMethod === "netbanking") {
			netbankingDetails.bankName = paymentData.bankName || "HDFC Bank";
		}

		// Extract billing details
		const rawBilling = paymentData.billingDetails || {};
		const billingDetails = {
			fullName: rawBilling.fullName || paymentData.cardHolderName || user.username || "Wander-Lust Traveler",
			email: rawBilling.email || user.email || `${user.username || "guest"}@example.com`,
			phone: rawBilling.phone || paymentData.phone || "+91 9876543210",
			address: rawBilling.address || paymentData.address || "123 Commercial Boulevard",
			city: rawBilling.city || paymentData.city || "Mumbai",
			state: rawBilling.state || paymentData.state || "Maharashtra",
			postalCode: rawBilling.postalCode || paymentData.postalCode || "400001",
			country: rawBilling.country || "India",
		};

		// Create & persist payment document
		const payment = new Payment({
			booking: booking._id,
			user: user._id,
			transactionId,
			orderId,
			receiptNumber,
			amount: booking.totalPrice,
			currency: "INR",
			paymentMethod,
			status: "succeeded",
			gateway: "wanderlust_pay",
			cardDetails,
			upiDetails,
			netbankingDetails,
			billingDetails,
		});

		await payment.save();

		// Update booking status
		booking.payment = payment._id;
		booking.paymentStatus = "paid";
		booking.status = "confirmed";
		await booking.save();

		// Notify guest & host of successful payment
		try {
			const NotificationService = require("./notification.service");
			await NotificationService.createNotification({
				recipient: booking.user,
				sender: null,
				type: "payment_succeeded",
				title: "Payment Successful",
				message: `Payment of ₹${booking.totalPrice.toLocaleString("en-IN")} for ${booking.listing ? booking.listing.title : "your reservation"} was successful. Receipt: ${receiptNumber}.`,
				link: `/payments/receipt/${payment._id}`,
				metadata: {
					paymentId: payment._id,
					bookingId: booking._id,
					receiptNumber,
					amount: booking.totalPrice,
				},
			});

			if (booking.listing && booking.listing.owner) {
				await NotificationService.createNotification({
					recipient: booking.listing.owner,
					sender: user._id,
					type: "payment_succeeded",
					title: "Payment Received",
					message: `Payment of ₹${booking.totalPrice.toLocaleString("en-IN")} confirmed for reservation at ${booking.listing.title}.`,
					link: `/bookings/host`,
					metadata: {
						paymentId: payment._id,
						bookingId: booking._id,
						amount: booking.totalPrice,
					},
				});
			}
		} catch (err) {
			console.error("[Notification Error - Payment Created]:", err.message);
		}

		return await Payment.findById(payment._id)
			.populate({
				path: "booking",
				populate: { path: "listing" },
			})
			.populate("user", "username email");
	}

	/**
	 * Process full refund upon booking cancellation.
	 */
	static async processRefund(bookingId, user, reason = "Booking cancelled by traveler") {
		if (!mongoose.Types.ObjectId.isValid(bookingId)) {
			throw AppError.notFound("Invalid booking ID");
		}

		const booking = await Booking.findById(bookingId).populate("listing");
		if (!booking) {
			throw AppError.notFound("Booking not found");
		}

		if (user) {
			const isGuest = String(booking.user) === String(user._id);
			const isHost =
				booking.listing &&
				booking.listing.owner &&
				String(booking.listing.owner) === String(user._id);

			if (!isGuest && !isHost) {
				throw AppError.forbidden("You are not authorized to refund this booking");
			}
		}

		const payment = await Payment.findOne({
			booking: bookingId,
			status: "succeeded",
		});

		if (!payment) {
			return null; // No succeeded payment to refund
		}

		payment.status = "refunded";
		payment.refundId = `rfnd_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
		payment.refundAmount = payment.amount;
		payment.refundReason = reason;
		payment.refundedAt = new Date();
		await payment.save();

		await Booking.findByIdAndUpdate(bookingId, { paymentStatus: "refunded" });

		// Notify guest of refund
		try {
			const NotificationService = require("./notification.service");
			await NotificationService.createNotification({
				recipient: booking.user,
				sender: null,
				type: "payment_refunded",
				title: "Refund Processed",
				message: `Full refund of ₹${payment.refundAmount.toLocaleString("en-IN")} has been processed for ${booking.listing ? booking.listing.title : "your reservation"}. Reference: ${payment.refundId}.`,
				link: `/payments/receipt/${payment._id}`,
				metadata: {
					paymentId: payment._id,
					bookingId: booking._id,
					refundId: payment.refundId,
					amount: payment.refundAmount,
				},
			});
		} catch (err) {
			console.error("[Notification Error - Payment Refunded]:", err.message);
		}

		return payment;
	}

	/**
	 * Retrieve single payment by ID with security authorization.
	 */
	static async getPaymentById(paymentId, user = null) {
		if (!mongoose.Types.ObjectId.isValid(paymentId)) {
			throw AppError.notFound("Invalid payment ID format");
		}

		const payment = await Payment.findById(paymentId)
			.populate({
				path: "booking",
				populate: { path: "listing" },
			})
			.populate("user", "username email");

		if (!payment) {
			throw AppError.notFound("Payment invoice not found");
		}

		if (user) {
			const isGuest = payment.user && String(payment.user._id || payment.user) === String(user._id);
			const isHost =
				payment.booking &&
				payment.booking.listing &&
				payment.booking.listing.owner &&
				String(payment.booking.listing.owner) === String(user._id);
			const isAdmin = user.role === "admin";

			if (!isGuest && !isHost && !isAdmin) {
				throw AppError.forbidden("You are not authorized to view this payment receipt");
			}
		}

		return payment;
	}

	/**
	 * Retrieve payment record associated with a given booking ID.
	 */
	static async getPaymentByBooking(bookingId, user = null) {
		if (!mongoose.Types.ObjectId.isValid(bookingId)) {
			throw AppError.notFound("Invalid booking ID format");
		}

		const payment = await Payment.findOne({ booking: bookingId })
			.populate({
				path: "booking",
				populate: { path: "listing" },
			})
			.populate("user", "username email");

		if (!payment) {
			return null;
		}

		if (user) {
			const isGuest = String(payment.user._id) === String(user._id);
			const isHost =
				payment.booking &&
				payment.booking.listing &&
				payment.booking.listing.owner &&
				String(payment.booking.listing.owner) === String(user._id);

			if (!isGuest && !isHost) {
				throw AppError.forbidden("You are not authorized to view this payment record");
			}
		}

		return payment;
	}

	/**
	 * Retrieve user's complete payment history.
	 */
	static async getUserPaymentHistory(userId) {
		return await Payment.find({ user: userId })
			.populate({
				path: "booking",
				populate: { path: "listing", select: "title location image country" },
			})
			.sort({ createdAt: -1 })
			.lean()
			.exec();
	}
}

module.exports = PaymentService;

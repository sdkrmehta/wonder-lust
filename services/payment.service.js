const crypto = require("crypto");
const mongoose = require("mongoose");
const Razorpay = require("razorpay");
const {
	validatePaymentVerification,
	validateWebhookSignature,
} = require("razorpay/dist/utils/razorpay-utils");
const Payment = require("../models/payment");
const Booking = require("../models/booking");
const BookingNightLock = require("../models/bookingNightLock");
const Listing = require("../models/listing");
const AppError = require("../utils/AppError");
const env = require("../config/env");

class PaymentService {
	static _getRazorpayClient() {
		if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
			throw new AppError(503, "Razorpay gateway credentials are not configured.");
		}
		const client = new Razorpay({
			key_id: env.RAZORPAY_KEY_ID,
			key_secret: env.RAZORPAY_KEY_SECRET,
		});
		if (client.api && client.api.rq && client.api.rq.defaults) {
			client.api.rq.defaults.timeout = 10000;
			if (env.RAZORPAY_API_BASE && env.RAZORPAY_API_BASE !== "https://api.razorpay.com") {
				client.api.rq.defaults.baseURL = env.RAZORPAY_API_BASE;
			}
		}
		return client;
	}

	static _verifyTimingSafeHex(expectedHex, providedHex) {
		if (typeof expectedHex !== "string" || typeof providedHex !== "string") {
			return false;
		}
		if (!/^[a-f0-9]+$/i.test(expectedHex) || !/^[a-f0-9]+$/i.test(providedHex)) {
			return false;
		}
		const expectedBuf = Buffer.from(expectedHex.toLowerCase(), "hex");
		const providedBuf = Buffer.from(providedHex.toLowerCase(), "hex");
		if (expectedBuf.length === 0 || expectedBuf.length !== providedBuf.length) {
			return false;
		}
		return crypto.timingSafeEqual(providedBuf, expectedBuf);
	}
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

		// Reject expired unpaid pending holds and clean up their locks immediately
		if (
			booking.status === "pending" &&
			booking.paymentStatus === "unpaid" &&
			booking.expiresAt &&
			booking.expiresAt <= new Date()
		) {
			const BookingService = require("./booking.service");
			await BookingService.expireAbandonedPendingBookings({
				listingId: booking.listing?._id || booking.listing,
				limit: 10,
			});
			throw AppError.badRequest("This pending reservation hold has expired. Please book again.");
		}

		// Check if already paid
		if (booking.paymentStatus === "paid") {
			throw AppError.badRequest("This booking has already been paid for");
		}
		const existingPayment = await Payment.findOne({
			booking: booking._id,
			status: "succeeded",
		});
		if (existingPayment) {
			throw AppError.badRequest("This booking has already been paid for");
		}

		// Amount verification (handle 0 and non-numeric values strictly)
		if (
			paymentData.amount !== undefined &&
			paymentData.amount !== null &&
			paymentData.amount !== ""
		) {
			const requestedAmount = Number(paymentData.amount);
			if (!Number.isFinite(requestedAmount) || requestedAmount !== booking.totalPrice) {
				throw AppError.badRequest(
					`Payment amount ₹${paymentData.amount} does not match booking total ₹${booking.totalPrice}`,
				);
			}
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
			fullName: rawBilling.fullName || paymentData.cardHolderName || user.username || "Wonder-Lust Traveler",
			email: rawBilling.email || user.email || `${user.username || "guest"}@example.com`,
			phone: rawBilling.phone || paymentData.phone || "+91 9876543210",
			address: rawBilling.address || paymentData.address || "123 Commercial Boulevard",
			city: rawBilling.city || paymentData.city || "Mumbai",
			state: rawBilling.state || paymentData.state || "Maharashtra",
			postalCode: rawBilling.postalCode || paymentData.postalCode || "400001",
			country: rawBilling.country || "India",
		};

		const provider = env.PAYMENT_PROVIDER;
		const requireGatewayConfirmation =
			env.isProduction ||
			env.PAYMENT_GATEWAY_MODE === "strict" ||
			provider === "razorpay" ||
			paymentData.requireWebhookConfirmation === true;

		if (provider === "razorpay") {
			if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
				throw new AppError(503, "Razorpay gateway credentials are not configured.");
			}

			const rpClient = this._getRazorpayClient();
			const amountPaise = Math.round(booking.totalPrice * 100);
			let rpOrder;
			try {
				rpOrder = await rpClient.orders.create({
					amount: amountPaise,
					currency: "INR",
					receipt: receiptNumber,
					notes: {
						bookingId: String(booking._id),
						listingId: String(booking.listing?._id || booking.listing),
						userId: String(user._id),
						preferredMethod: paymentMethod,
					},
				});
			} catch (err) {
				const gatewayMsg =
					err?.error?.description || err?.message || "Failed to initialize Razorpay order";
				throw new AppError(502, `Payment gateway error: ${gatewayMsg}`);
			}

			if (!rpOrder || !rpOrder.id) {
				throw new AppError(502, "Payment gateway returned an invalid order response");
			}

			await Payment.updateMany(
				{ booking: booking._id, status: "pending" },
				{ status: "failed" },
			);

			const payment = new Payment({
				booking: booking._id,
				user: user._id,
				transactionId,
				orderId: rpOrder.id,
				gatewayOrderId: rpOrder.id,
				receiptNumber,
				amount: booking.totalPrice,
				currency: rpOrder.currency || "INR",
				paymentMethod,
				status: "pending",
				gateway: "razorpay",
				webhookVerified: false,
				cardDetails,
				upiDetails,
				netbankingDetails,
				billingDetails,
			});
			await payment.save();

			booking.payment = payment._id;
			booking.paymentStatus = "unpaid";
			booking.status = "pending";
			await booking.save();

			const populated = await Payment.findById(payment._id)
				.populate({
					path: "booking",
					populate: { path: "listing" },
				})
				.populate("user", "username email");

			const responseObj = populated.toObject();
			responseObj.razorpayOrder = {
				keyId: env.RAZORPAY_KEY_ID,
				orderId: rpOrder.id,
				amountPaise: rpOrder.amount,
				currency: rpOrder.currency || "INR",
				receipt: receiptNumber,
			};
			return responseObj;
		}

		if (
			requireGatewayConfirmation &&
			(!env.PAYMENT_WEBHOOK_SECRET || env.PAYMENT_WEBHOOK_SECRET.length < 32)
		) {
			throw new AppError(
				503,
				"Payment gateway webhook verification is not configured.",
			);
		}

		// Supersede any stale pending payment orders for this booking so only one active order exists
		await Payment.updateMany(
			{ booking: booking._id, status: "pending" },
			{ status: "failed" },
		);

		// Create & persist payment document (strict/production mode waits in 'pending' until signed webhook)
		const payment = new Payment({
			booking: booking._id,
			user: user._id,
			transactionId,
			orderId,
			receiptNumber,
			amount: booking.totalPrice,
			currency: "INR",
			paymentMethod,
			status: requireGatewayConfirmation ? "pending" : "succeeded",
			gateway: requireGatewayConfirmation
				? "wonderlust_pay_gateway"
				: "wonderlust_pay_sandbox",
			webhookVerified: false,
			cardDetails,
			upiDetails,
			netbankingDetails,
			billingDetails,
		});

		await payment.save();

		if (requireGatewayConfirmation) {
			booking.payment = payment._id;
			booking.paymentStatus = "unpaid";
			booking.status = "pending";
			await booking.save();

			return await Payment.findById(payment._id)
				.populate({
					path: "booking",
					populate: { path: "listing" },
				})
				.populate("user", "username email");
		}

		// Sandbox / non-production synchronous confirmation path
		booking.payment = payment._id;
		booking.paymentStatus = "paid";
		booking.status = "confirmed";
		booking.expiresAt = null;
		await booking.save();

		await this._sendPaymentSuccessNotifications(booking, payment, user._id, receiptNumber);

		return await Payment.findById(payment._id)
			.populate({
				path: "booking",
				populate: { path: "listing" },
			})
			.populate("user", "username email");
	}

	static async _sendPaymentSuccessNotifications(booking, payment, senderUserId, receiptNumber) {
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
					sender: senderUserId || booking.user,
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
	}

	/**
	 * Verify frontend Razorpay Checkout signature (`HMAC-SHA256(order_id + "|" + payment_id, key_secret)`).
	 */
	static async verifyRazorpayPayment(verificationData = {}, user) {
		if (!env.RAZORPAY_KEY_SECRET) {
			throw new AppError(503, "Razorpay secret key is not configured.");
		}

		const { bookingId, razorpay_order_id, razorpay_payment_id, razorpay_signature } =
			verificationData;
		if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
			throw AppError.badRequest("Missing Razorpay payment verification parameters");
		}

		const payment = await Payment.findOne({
			$or: [{ gatewayOrderId: razorpay_order_id }, { orderId: razorpay_order_id }],
		});
		if (!payment) {
			throw AppError.notFound("Referenced Razorpay payment order not found");
		}

		if (user && String(payment.user) !== String(user._id)) {
			throw AppError.forbidden("You are not authorized to verify this payment");
		}
		if (bookingId && String(payment.booking) !== String(bookingId)) {
			throw AppError.badRequest("Payment order does not belong to the requested booking");
		}

		const expectedSig = crypto
			.createHmac("sha256", env.RAZORPAY_KEY_SECRET)
			.update(`${razorpay_order_id}|${razorpay_payment_id}`)
			.digest("hex");
		const sdkValid = validatePaymentVerification(
			{ order_id: razorpay_order_id, payment_id: razorpay_payment_id },
			razorpay_signature,
			env.RAZORPAY_KEY_SECRET,
		);
		if (!sdkValid || !this._verifyTimingSafeHex(expectedSig, razorpay_signature)) {
			throw new AppError(401, "Invalid Razorpay payment signature");
		}

		const booking = await Booking.findById(payment.booking).populate("listing");
		if (!booking) {
			throw AppError.notFound("Associated booking not found");
		}

		if (payment.status === "succeeded") {
			const populatedAlready = await this.getPaymentById(payment._id, user);
			return { payment: populatedAlready, booking, idempotent: true };
		}
		if (payment.status !== "pending") {
			throw AppError.badRequest(`Cannot confirm payment in state '${payment.status}'`);
		}
		if (booking.status === "cancelled") {
			throw AppError.badRequest("Booking has already been cancelled");
		}
		if (booking.paymentStatus === "paid" && String(booking.payment) !== String(payment._id)) {
			payment.status = "failed";
			await payment.save();
			throw AppError.badRequest("Booking has already been paid by a newer order");
		}

		payment.status = "succeeded";
		payment.gatewayPaymentId = razorpay_payment_id;
		payment.transactionId = razorpay_payment_id;
		payment.gatewaySignatureVerifiedAt = new Date();
		await payment.save();

		booking.payment = payment._id;
		booking.paymentStatus = "paid";
		booking.status = "confirmed";
		booking.expiresAt = null;
		await booking.save();

		await this._sendPaymentSuccessNotifications(
			booking,
			payment,
			payment.user,
			payment.receiptNumber,
		);

		const populated = await this.getPaymentById(payment._id, user);
		return { payment: populated, booking, idempotent: false };
	}

	/**
	 * Verify incoming Razorpay webhook signature (`X-Razorpay-Signature`) over raw request body.
	 */
	static verifyRazorpayWebhookSignature(rawBody, signatureHeader) {
		const secret = env.RAZORPAY_WEBHOOK_SECRET;
		if (!secret) {
			throw new AppError(503, "Razorpay webhook secret is not configured");
		}
		if (!signatureHeader || typeof signatureHeader !== "string") {
			throw new AppError(401, "Missing Razorpay webhook signature header");
		}
		const rawStr = Buffer.isBuffer(rawBody)
			? rawBody.toString("utf8")
			: typeof rawBody === "string"
				? rawBody
				: JSON.stringify(rawBody || {});
		const expectedHex = crypto
			.createHmac("sha256", secret)
			.update(rawStr)
			.digest("hex");
		const sdkValid = validateWebhookSignature(rawStr, signatureHeader, secret);
		if (!sdkValid || !this._verifyTimingSafeHex(expectedHex, signatureHeader.trim())) {
			throw new AppError(401, "Invalid Razorpay webhook signature");
		}
		return true;
	}

	/**
	 * Compute HMAC-SHA256 webhook signature header (`t=<sec>,v1=<hex>`).
	 */
	static signWebhookPayload(rawPayload, timestampSec, secret) {
		const rawStr = Buffer.isBuffer(rawPayload)
			? rawPayload.toString("utf8")
			: typeof rawPayload === "string"
				? rawPayload
				: JSON.stringify(rawPayload);
		const sig = crypto
			.createHmac("sha256", secret)
			.update(`${timestampSec}.${rawStr}`)
			.digest("hex");
		return `t=${timestampSec},v1=${sig}`;
	}

	/**
	 * Verify HMAC-SHA256 signature and timestamp window (anti-replay) on incoming webhook.
	 */
	static verifyWebhookSignature(rawBody, signatureHeader) {
		const secret = env.PAYMENT_WEBHOOK_SECRET;
		if (!secret || secret.length < 32) {
			throw new AppError(503, "Payment webhook secret is not configured");
		}
		if (!signatureHeader || typeof signatureHeader !== "string") {
			throw new AppError(401, "Missing webhook signature header");
		}

		const parts = Object.fromEntries(
			signatureHeader.split(",").map((kv) => {
				const idx = kv.indexOf("=");
				return idx > 0 ? [kv.slice(0, idx).trim(), kv.slice(idx + 1).trim()] : ["", ""];
			}),
		);

		const ts = parseInt(parts.t, 10);
		const sigHex = parts.v1 || "";
		if (!Number.isFinite(ts) || !/^[a-f0-9]{64}$/i.test(sigHex)) {
			throw new AppError(401, "Malformed webhook signature header");
		}

		const nowSec = Math.floor(Date.now() / 1000);
		if (Math.abs(nowSec - ts) > 300) {
			throw new AppError(401, "Webhook signature timestamp expired");
		}

		const rawStr = Buffer.isBuffer(rawBody)
			? rawBody.toString("utf8")
			: typeof rawBody === "string"
				? rawBody
				: JSON.stringify(rawBody || {});
		const expectedHex = crypto
			.createHmac("sha256", secret)
			.update(`${ts}.${rawStr}`)
			.digest("hex");

		const providedBuf = Buffer.from(sigHex.toLowerCase(), "hex");
		const expectedBuf = Buffer.from(expectedHex.toLowerCase(), "hex");
		if (
			providedBuf.length !== expectedBuf.length ||
			!crypto.timingSafeEqual(providedBuf, expectedBuf)
		) {
			throw new AppError(401, "Invalid webhook signature");
		}
		return true;
	}

	/**
	 * Authenticate and process payment gateway webhook events idempotently
	 * (supports Razorpay X-Razorpay-Signature events and internal X-Payment-Signature events).
	 */
	static async processWebhookEvent(rawBody, signatureOrHeaders, parsedBody = null) {
		const headersObj =
			typeof signatureOrHeaders === "object" && signatureOrHeaders !== null
				? signatureOrHeaders
				: { paymentSignature: signatureOrHeaders };

		if (headersObj.razorpaySignature !== undefined && headersObj.razorpaySignature !== "") {
			return await this._processRazorpayWebhookEvent(
				rawBody,
				headersObj.razorpaySignature,
				headersObj.razorpayEventId || null,
				parsedBody,
			);
		}

		// If caller sent Razorpay payload shape (`event` + `payload`) without X-Razorpay-Signature
		// while Razorpay is active and no internal signature provided, enforce Razorpay verification
		if (
			!headersObj.paymentSignature &&
			parsedBody &&
			typeof parsedBody === "object" &&
			typeof parsedBody.event === "string" &&
			env.PAYMENT_PROVIDER === "razorpay"
		) {
			return await this._processRazorpayWebhookEvent(
				rawBody,
				"",
				headersObj.razorpayEventId || null,
				parsedBody,
			);
		}

		this.verifyWebhookSignature(rawBody, headersObj.paymentSignature || "");

		let event = parsedBody;
		if (!event || typeof event !== "object") {
			try {
				const str = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || "{}");
				event = JSON.parse(str);
			} catch {
				throw AppError.badRequest("Invalid JSON webhook payload");
			}
		}

		const { eventId, eventType, orderId, transactionId, amount, reason } = event;
		if (!eventType || (!orderId && !transactionId)) {
			throw AppError.badRequest("Webhook payload missing eventType or order identifier");
		}

		const query = orderId ? { orderId } : { transactionId };
		const payment = await Payment.findOne(query);
		if (!payment) {
			throw AppError.notFound("Referenced payment order not found");
		}

		if (eventId && payment.webhookEventId === String(eventId)) {
			return { payment, idempotent: true };
		}

		const booking = await Booking.findById(payment.booking).populate("listing");
		if (!booking) {
			throw AppError.notFound("Associated booking not found");
		}

		if (eventType === "payment.succeeded") {
			if (payment.status === "succeeded") {
				return { payment, idempotent: true };
			}
			if (payment.status !== "pending") {
				throw AppError.badRequest(`Cannot confirm payment in state '${payment.status}'`);
			}
			if (booking.paymentStatus === "paid" && String(booking.payment) !== String(payment._id)) {
				payment.status = "failed";
				await payment.save();
				throw AppError.badRequest("Booking has already been paid by a newer order");
			}
			if (amount !== undefined && Number(amount) !== payment.amount) {
				throw AppError.badRequest("Webhook amount mismatch");
			}

			payment.status = "succeeded";
			payment.webhookVerified = true;
			payment.webhookEventId = eventId ? String(eventId) : payment.webhookEventId;
			payment.gatewaySignatureVerifiedAt = new Date();
			await payment.save();

			booking.payment = payment._id;
			booking.paymentStatus = "paid";
			booking.status = "confirmed";
			booking.expiresAt = null;
			await booking.save();

			await this._sendPaymentSuccessNotifications(
				booking,
				payment,
				payment.user,
				payment.receiptNumber,
			);
			return { payment, idempotent: false };
		}

		if (eventType === "payment.failed") {
			if (payment.status === "failed") {
				return { payment, idempotent: true };
			}
			if (payment.status === "succeeded") {
				throw AppError.badRequest("Cannot fail an already succeeded payment");
			}
			payment.status = "failed";
			payment.webhookVerified = true;
			payment.webhookEventId = eventId ? String(eventId) : payment.webhookEventId;
			payment.gatewaySignatureVerifiedAt = new Date();
			await payment.save();

			booking.status = "cancelled";
			booking.paymentStatus = "unpaid";
			booking.expiresAt = null;
			await booking.save();
			await BookingNightLock.deleteMany({ booking: booking._id });
			return { payment, idempotent: false };
		}

		if (eventType === "payment.refunded") {
			if (payment.status === "refunded") {
				return { payment, idempotent: true };
			}
			if (payment.status !== "succeeded") {
				throw AppError.badRequest("Only succeeded payments can be refunded");
			}
			payment.status = "refunded";
			payment.webhookVerified = true;
			payment.webhookEventId = eventId ? String(eventId) : payment.webhookEventId;
			payment.gatewaySignatureVerifiedAt = new Date();
			payment.refundId = payment.refundId || `rfnd_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
			payment.refundAmount = payment.amount;
			payment.refundReason = reason || "Refunded via payment gateway webhook";
			payment.refundedAt = new Date();
			await payment.save();

			booking.status = "cancelled";
			booking.paymentStatus = "refunded";
			booking.expiresAt = null;
			await booking.save();
			await BookingNightLock.deleteMany({ booking: booking._id });
			return { payment, idempotent: false };
		}

		throw AppError.badRequest(`Unsupported webhook eventType: ${eventType}`);
	}

	static async _processRazorpayWebhookEvent(rawBody, signatureHeader, headerEventId, parsedBody = null) {
		this.verifyRazorpayWebhookSignature(rawBody, signatureHeader);

		let body = parsedBody;
		if (!body || typeof body !== "object") {
			try {
				const str = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || "{}");
				body = JSON.parse(str);
			} catch {
				throw AppError.badRequest("Invalid Razorpay webhook JSON payload");
			}
		}

		const eventName = body.event;
		const rpPayment = body.payload?.payment?.entity;
		const rpOrder = body.payload?.order?.entity;
		const rpRefund = body.payload?.refund?.entity;

		const gatewayOrderId =
			rpPayment?.order_id || rpOrder?.id || rpRefund?.payment_id || null;
		const gatewayPaymentId = rpPayment?.id || rpRefund?.payment_id || null;
		const eventId =
			headerEventId ||
			(eventName
				? `${eventName}:${rpRefund?.id || rpPayment?.id || rpOrder?.id || "evt"}:${body.created_at || ""}`
				: null);

		if (!eventName || (!gatewayOrderId && !gatewayPaymentId)) {
			throw AppError.badRequest("Razorpay webhook missing event or order/payment identifier");
		}

		const payment = await Payment.findOne({
			$or: [
				...(gatewayOrderId ? [{ gatewayOrderId }, { orderId: gatewayOrderId }] : []),
				...(gatewayPaymentId ? [{ gatewayPaymentId }, { transactionId: gatewayPaymentId }] : []),
			],
		});
		if (!payment) {
			throw AppError.notFound("Referenced payment order not found");
		}

		if (eventId && payment.webhookEventId === String(eventId)) {
			return { payment, idempotent: true };
		}

		const booking = await Booking.findById(payment.booking).populate("listing");
		if (!booking) {
			throw AppError.notFound("Associated booking not found");
		}

		if (eventName === "payment.captured" || eventName === "order.paid") {
			if (payment.status === "succeeded") {
				payment.webhookVerified = true;
				payment.webhookEventId = eventId || payment.webhookEventId;
				await payment.save();
				return { payment, idempotent: true };
			}
			if (payment.status !== "pending") {
				throw AppError.badRequest(`Cannot confirm payment in state '${payment.status}'`);
			}
			if (booking.paymentStatus === "paid" && String(booking.payment) !== String(payment._id)) {
				payment.status = "failed";
				await payment.save();
				throw AppError.badRequest("Booking has already been paid by a newer order");
			}
			const entityAmountPaise = rpPayment?.amount ?? rpOrder?.amount_paid ?? rpOrder?.amount;
			const expectedPaise = Math.round(payment.amount * 100);
			if (entityAmountPaise !== undefined && Number(entityAmountPaise) !== expectedPaise) {
				throw AppError.badRequest("Razorpay webhook amount mismatch");
			}

			payment.status = "succeeded";
			if (gatewayPaymentId) {
				payment.gatewayPaymentId = gatewayPaymentId;
				payment.transactionId = gatewayPaymentId;
			}
			payment.webhookVerified = true;
			payment.webhookEventId = eventId;
			payment.gatewaySignatureVerifiedAt = new Date();
			await payment.save();

			booking.payment = payment._id;
			booking.paymentStatus = "paid";
			booking.status = "confirmed";
			booking.expiresAt = null;
			await booking.save();

			await this._sendPaymentSuccessNotifications(
				booking,
				payment,
				payment.user,
				payment.receiptNumber,
			);
			return { payment, idempotent: false };
		}

		if (eventName === "payment.failed") {
			if (payment.status === "failed") {
				return { payment, idempotent: true };
			}
			if (payment.status === "succeeded") {
				throw AppError.badRequest("Cannot fail an already succeeded payment");
			}
			payment.status = "failed";
			if (gatewayPaymentId) {
				payment.gatewayPaymentId = gatewayPaymentId;
			}
			payment.webhookVerified = true;
			payment.webhookEventId = eventId;
			payment.gatewaySignatureVerifiedAt = new Date();
			await payment.save();

			booking.status = "cancelled";
			booking.paymentStatus = "unpaid";
			booking.expiresAt = null;
			booking.cancellationReason = rpPayment?.error_description || "Payment failed at Razorpay gateway";
			await booking.save();
			await BookingNightLock.deleteMany({ booking: booking._id });
			return { payment, idempotent: false };
		}

		if (eventName === "refund.processed" || eventName === "refund.created") {
			if (payment.status === "refunded") {
				return { payment, idempotent: true };
			}
			if (payment.status !== "succeeded") {
				throw AppError.badRequest("Only succeeded payments can be refunded");
			}
			payment.status = "refunded";
			payment.webhookVerified = true;
			payment.webhookEventId = eventId;
			payment.gatewaySignatureVerifiedAt = new Date();
			payment.refundId = rpRefund?.id || payment.refundId || `rfnd_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
			payment.refundAmount =
				rpRefund?.amount !== undefined ? Math.round(rpRefund.amount / 100) : payment.amount;
			payment.refundReason = rpRefund?.notes?.reason || "Refunded via Razorpay webhook";
			payment.refundedAt = new Date();
			await payment.save();

			booking.status = "cancelled";
			booking.paymentStatus = "refunded";
			booking.expiresAt = null;
			await booking.save();
			await BookingNightLock.deleteMany({ booking: booking._id });
			return { payment, idempotent: false };
		}

		throw AppError.badRequest(`Unsupported Razorpay webhook event: ${eventName}`);
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

		let gatewayRefundId = null;
		if (payment.gateway === "razorpay") {
			if (!payment.gatewayPaymentId) {
				throw AppError.badRequest(
					"Razorpay payment ID is missing on payment record; cannot execute gateway refund",
				);
			}
			const rpClient = this._getRazorpayClient();
			let rpRefund;
			try {
				rpRefund = await rpClient.payments.refund(payment.gatewayPaymentId, {
					amount: Math.round(payment.amount * 100),
					notes: {
						bookingId: String(booking._id),
						reason,
					},
				});
			} catch (err) {
				const gatewayMsg =
					err?.error?.description || err?.message || "Razorpay refund API request failed";
				throw new AppError(502, `Payment gateway refund failed: ${gatewayMsg}`);
			}
			gatewayRefundId = rpRefund?.id;
			if (!gatewayRefundId) {
				throw new AppError(502, "Razorpay refund API did not return a refund ID");
			}
		}

		payment.status = "refunded";
		payment.refundId =
			gatewayRefundId || `rfnd_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
		payment.refundAmount = payment.amount;
		payment.refundReason = reason;
		payment.refundedAt = new Date();
		await payment.save();

		await Booking.findByIdAndUpdate(bookingId, {
			status: "cancelled",
			paymentStatus: "refunded",
			expiresAt: null,
		});
		await BookingNightLock.deleteMany({ booking: booking._id });

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
			.sort({ createdAt: -1 })
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

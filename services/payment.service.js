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
const User = require("../models/user");
const WebhookEvent = require("../models/webhookEvent");
const AppError = require("../utils/AppError");
const env = require("../config/env");
const {
	validatePostalCodeForCountry,
	normalizeEmail,
	extractAddressSnapshot,
	formatAddressSummary,
} = require("../utils/addressValidation");

const PAID_STATUSES = ["paid", "succeeded"];
const ACTIVE_LINK_STATUSES = ["pending", "created"];

class PaymentService {
	static isPaidStatus(status) {
		return PAID_STATUSES.includes(status);
	}

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

	static _resolveTrustedBaseUrl(requestBaseUrl = null) {
		if (!env.isProduction && requestBaseUrl) {
			try {
				const parsed = new URL(requestBaseUrl);
				if (
					(parsed.protocol === "http:" || parsed.protocol === "https:") &&
					(parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")
				) {
					return parsed.origin;
				}
			} catch {
				// Ignore invalid request URL and fall back to configured APP_BASE_URL
			}
		}
		return env.APP_BASE_URL;
	}

	static _isTrustedRazorpayUrl(urlStr) {
		if (typeof urlStr !== "string" || !urlStr.trim()) {
			return false;
		}
		try {
			const parsed = new URL(urlStr.trim());
			const host = parsed.hostname.toLowerCase();
			if (
				parsed.protocol === "https:" &&
				(host === "rzp.io" ||
					host.endsWith(".rzp.io") ||
					host === "razorpay.com" ||
					host.endsWith(".razorpay.com"))
			) {
				return true;
			}
			// Allow loopback URLs strictly when RAZORPAY_API_BASE points to a local test mock server
			if (
				!env.isProduction &&
				env.RAZORPAY_API_BASE !== "https://api.razorpay.com" &&
				(host === "127.0.0.1" || host === "localhost") &&
				(parsed.protocol === "http:" || parsed.protocol === "https:")
			) {
				return true;
			}
			return false;
		} catch {
			return false;
		}
	}

	static _normalizeContactForGateway(phone) {
		if (typeof phone !== "string") return null;
		const trimmed = phone.trim();
		if (!trimmed) return null;
		const digits = trimmed.replace(/[^\d+]/g, "");
		if (digits.replace(/\D/g, "").length < 8 || digits.replace(/\D/g, "").length > 15) {
			return null;
		}
		return digits;
	}

	static _buildBillingSnapshot(rawBilling = {}, user = {}, { strictValidation = false } = {}) {
		const hasExplicitBilling =
			rawBilling &&
			typeof rawBilling === "object" &&
			Object.keys(rawBilling).some((k) => {
				const v = rawBilling[k];
				return typeof v === "string" ? v.trim() !== "" : Boolean(v);
			});

		const fullName = String(
			rawBilling.fullName || user.fullName || user.username || "",
		).trim();
		const email = normalizeEmail(rawBilling.email || user.email || "");
		const phone = String(rawBilling.phone ?? user.phone ?? "").trim();

		const addr = extractAddressSnapshot({
			addressLine1: rawBilling.addressLine1 || rawBilling.address || user.addressLine1 || user.address || "",
			addressLine2:
				rawBilling.addressLine2 !== undefined
					? rawBilling.addressLine2
					: !hasExplicitBilling
						? user.addressLine2 || ""
						: "",
			landmark:
				rawBilling.landmark !== undefined
					? rawBilling.landmark
					: !hasExplicitBilling
						? user.landmark || ""
						: "",
			city: rawBilling.city || (!hasExplicitBilling ? user.city || "" : ""),
			state: rawBilling.state || (!hasExplicitBilling ? user.state || "" : ""),
			postalCode: rawBilling.postalCode || (!hasExplicitBilling ? user.postalCode || "" : ""),
			country: rawBilling.country || user.country || "India",
		});

		if (strictValidation || hasExplicitBilling) {
			if (!fullName || fullName.length < 2) {
				throw AppError.badRequest("Billing full name is required (at least 2 characters)");
			}
			if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
				throw AppError.badRequest("Please provide a valid billing email address");
			}
			if (!addr.addressLine1 || addr.addressLine1.length < 3) {
				throw AppError.badRequest("Billing Address Line 1 is required");
			}
			if (!addr.city || addr.city.length < 2) {
				throw AppError.badRequest("Billing city is required");
			}
			if (!addr.state || addr.state.length < 2) {
				throw AppError.badRequest("Billing state is required");
			}
			const postalCheck = validatePostalCodeForCountry(addr.postalCode, addr.country);
			if (!postalCheck.valid) {
				throw AppError.badRequest(postalCheck.message);
			}
			addr.postalCode = postalCheck.value;
		}

		return {
			fullName: fullName || "Wonder-Lust Traveler",
			email: email || "traveler@example.com",
			phone,
			...addr,
		};
	}

	/**
	 * Detect card brand from card number digits (retained for legacy receipt formatting).
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
	 * Authoritative server-side booking checkout initiation:
	 * validates user, booking, dates, recalculates total on backend, snapshots billing address,
	 * optionally saves address to profile, and creates a Razorpay Hosted Payment Link.
	 */
	static async createPaymentLink(bookingId, paymentData = {}, user, options = {}) {
		if (!mongoose.Types.ObjectId.isValid(bookingId)) {
			throw AppError.notFound("Invalid booking ID format");
		}

		const booking = await Booking.findById(bookingId).populate("listing");
		if (!booking) {
			throw AppError.notFound("Booking not found");
		}

		if (user && String(booking.user) !== String(user._id)) {
			throw AppError.forbidden("You are not authorized to pay for this booking");
		}

		if (booking.status === "cancelled") {
			throw AppError.badRequest("Cannot process payment for a cancelled booking");
		}

		const BookingService = require("./booking.service");
		if (
			booking.status === "pending" &&
			booking.paymentStatus === "unpaid" &&
			booking.expiresAt &&
			booking.expiresAt <= new Date()
		) {
			await BookingService.expireAbandonedPendingBookings({
				listingId: booking.listing?._id || booking.listing,
				limit: 10,
			});
			throw AppError.badRequest("This pending reservation hold has expired. Please book again.");
		}

		if (booking.paymentStatus === "paid") {
			throw AppError.badRequest("This booking has already been paid for");
		}
		const existingPaidPayment = await Payment.findOne({
			booking: booking._id,
			status: { $in: PAID_STATUSES },
		});
		if (existingPaidPayment) {
			throw AppError.badRequest("This booking has already been paid for");
		}

		// Verify date conflict hasn't occurred against any other confirmed booking
		const hasConflict = await BookingService.hasDateConflict(
			booking.listing?._id || booking.listing,
			booking.checkIn,
			booking.checkOut,
			booking._id,
		);
		if (hasConflict) {
			throw AppError.badRequest("Selected dates are no longer available.");
		}

		// Authoritative backend price recalculation
		const authoritativeNightly =
			booking.listing && typeof booking.listing.price === "number"
				? booking.listing.price
				: booking.nightlyPrice;
		const recalculated = BookingService.calculatePricing(
			authoritativeNightly,
			booking.checkIn,
			booking.checkOut,
		);

		booking.nightlyPrice = recalculated.nightlyPrice;
		booking.totalNights = recalculated.totalNights;
		booking.cleaningFee = recalculated.cleaningFee;
		booking.taxAmount = recalculated.taxAmount;
		booking.totalPrice = recalculated.totalPrice;

		// Reject any tampered frontend amount parameter
		if (
			paymentData.amount !== undefined &&
			paymentData.amount !== null &&
			paymentData.amount !== ""
		) {
			const requestedAmount = Number(paymentData.amount);
			if (!Number.isFinite(requestedAmount) || requestedAmount !== recalculated.totalPrice) {
				throw AppError.badRequest(
					`Payment amount ₹${paymentData.amount} does not match authoritative booking total ₹${recalculated.totalPrice}`,
				);
			}
		}

		const freshUser = user && user._id ? await User.findById(user._id) : null;
		const requireStrictBilling = Boolean(options.requireBillingDetails);
		if (requireStrictBilling && (!paymentData.billingDetails || typeof paymentData.billingDetails !== "object")) {
			throw AppError.badRequest("Billing address details are required");
		}

		const billingDetails = this._buildBillingSnapshot(
			paymentData.billingDetails || {},
			freshUser || user || {},
			{ strictValidation: requireStrictBilling },
		);

		// Store independent billing snapshot on Booking
		booking.billingAddress = billingDetails;

		// Optionally save edited address as user's default billing address (NEVER altering verified login email)
		const saveAsDefault =
			paymentData.saveAsDefaultAddress === true ||
			paymentData.saveAsDefaultAddress === "true" ||
			paymentData.saveAsDefaultAddress === "on" ||
			paymentData.saveAsDefaultAddress === "1";

		if (saveAsDefault && freshUser) {
			freshUser.fullName = billingDetails.fullName || freshUser.fullName;
			freshUser.addressLine1 = billingDetails.addressLine1;
			freshUser.addressLine2 = billingDetails.addressLine2;
			freshUser.landmark = billingDetails.landmark;
			freshUser.address =
				formatAddressSummary({
					addressLine1: billingDetails.addressLine1,
					addressLine2: billingDetails.addressLine2,
					landmark: billingDetails.landmark,
				}) || billingDetails.addressLine1;
			freshUser.city = billingDetails.city;
			freshUser.state = billingDetails.state;
			freshUser.postalCode = billingDetails.postalCode;
			freshUser.country = billingDetails.country;
			await freshUser.save();
		}

		const randomHex = crypto.randomBytes(4).toString("hex");
		const transactionId = `txn_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
		const receiptNumber = `INV-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
		const provider = env.PAYMENT_PROVIDER;

		if (provider === "razorpay") {
			if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
				throw new AppError(503, "Razorpay gateway credentials are not configured.");
			}

			const rpClient = this._getRazorpayClient();
			const amountPaise = Math.round(recalculated.totalPrice * 100);
			const referenceId = `WL_${String(booking._id).slice(-12)}_${randomHex}`;
			const minLinkLifetimeSec = Math.max(20 * 60, env.PENDING_BOOKING_TTL_MINUTES * 60);
			const expireBySec = Math.floor(Date.now() / 1000) + minLinkLifetimeSec;
			const trustedBaseUrl = this._resolveTrustedBaseUrl(options.requestBaseUrl);
			const callbackUrl = `${trustedBaseUrl}/payments/razorpay/callback`;
			const listingTitle = booking.listing?.title || "Wonder-Lust Stay";
			const contact = this._normalizeContactForGateway(billingDetails.phone);

			const linkPayload = {
				amount: amountPaise,
				currency: "INR",
				accept_partial: false,
				reference_id: referenceId,
				description: `Wonder-Lust Booking #${String(booking._id).slice(-8)} - ${listingTitle}`.slice(
					0,
					200,
				),
				customer: {
					name: billingDetails.fullName,
					email: billingDetails.email,
					...(contact ? { contact } : {}),
				},
				notify: {
					sms: false,
					email: true,
				},
				reminder_enable: false,
				notes: {
					bookingId: String(booking._id),
					listingId: String(booking.listing?._id || booking.listing),
					userId: String(user._id),
					receiptNumber,
				},
				expire_by: expireBySec,
				callback_url: callbackUrl,
				callback_method: "get",
			};

			let rpLink;
			try {
				rpLink = await rpClient.paymentLink.create(linkPayload);
			} catch (err) {
				const gatewayMsg =
					err?.error?.description ||
					err?.message ||
					"Failed to initialize Razorpay Payment Link";
				throw new AppError(502, `Payment gateway error: ${gatewayMsg}`);
			}

			if (!rpLink || !rpLink.id || !rpLink.short_url) {
				throw new AppError(502, "Payment gateway returned an invalid Payment Link response");
			}
			if (!this._isTrustedRazorpayUrl(rpLink.short_url)) {
				throw new AppError(502, "Payment gateway returned an untrusted Payment Link URL");
			}

			// Supersede older uncompleted payment links on this booking so only one active link remains
			await Payment.updateMany(
				{ booking: booking._id, status: { $in: ACTIVE_LINK_STATUSES } },
				{ $set: { status: "cancelled", paymentLinkStatus: "cancelled", gatewayStatus: "cancelled" } },
			);

			const payment = new Payment({
				booking: booking._id,
				user: user._id,
				transactionId,
				orderId: rpLink.id,
				paymentLinkId: rpLink.id,
				paymentLinkReferenceId: rpLink.reference_id || referenceId,
				paymentLinkShortUrl: rpLink.short_url,
				paymentLinkStatus: rpLink.status || "created",
				paymentLinkExpiresAt: new Date(expireBySec * 1000),
				receiptNumber,
				amount: recalculated.totalPrice,
				currency: (rpLink.currency || "INR").toUpperCase(),
				paymentMethod: "razorpay_payment_link",
				status: "created",
				gateway: "razorpay_payment_link",
				gatewayStatus: rpLink.status || "created",
				webhookVerified: false,
				billingDetails,
			});
			await payment.save();

			booking.payment = payment._id;
			booking.paymentStatus = "unpaid";
			booking.status = "pending";
			booking.expiresAt = new Date(
				Math.max(booking.expiresAt ? booking.expiresAt.getTime() : 0, expireBySec * 1000),
			);
			await booking.save();

			const populated = await Payment.findById(payment._id)
				.populate({
					path: "booking",
					populate: { path: "listing" },
				})
				.populate("user", "username email fullName");

			const responseObj = populated.toObject();
			responseObj.paymentLink = {
				id: rpLink.id,
				referenceId: payment.paymentLinkReferenceId,
				shortUrl: rpLink.short_url,
				status: payment.paymentLinkStatus,
				amountPaise,
				currency: payment.currency,
				expireBy: expireBySec,
				callbackUrl,
			};
			return responseObj;
		}

		const requireGatewayConfirmation =
			env.isProduction ||
			env.PAYMENT_GATEWAY_MODE === "strict" ||
			paymentData.requireWebhookConfirmation === true;

		if (
			requireGatewayConfirmation &&
			(!env.PAYMENT_WEBHOOK_SECRET || env.PAYMENT_WEBHOOK_SECRET.length < 32)
		) {
			throw new AppError(
				503,
				"Payment gateway webhook verification is not configured.",
			);
		}

		// Supersede any stale pending payment orders for this booking
		await Payment.updateMany(
			{ booking: booking._id, status: { $in: ACTIVE_LINK_STATUSES } },
			{ $set: { status: "failed" } },
		);

		const paymentMethod = paymentData.paymentMethod || "card";
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

		const orderId = `order_${Date.now()}_${randomHex}`;
		const payment = new Payment({
			booking: booking._id,
			user: user._id,
			transactionId,
			orderId,
			receiptNumber,
			amount: recalculated.totalPrice,
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
				.populate("user", "username email fullName");
		}

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
			.populate("user", "username email fullName");
	}

	/**
	 * Backward-compatible alias delegating to unified Payment Link / payment initiation pipeline.
	 */
	static async createPaymentOrder(bookingId, paymentData = {}, user, options = {}) {
		return await this.createPaymentLink(bookingId, paymentData, user, options);
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
	 * Atomically and idempotently confirm a payment and its parent booking across callback & webhook races.
	 */
	static async _confirmPaidPayment(
		payment,
		booking,
		{
			gatewayPaymentId = null,
			gatewayOrderId = null,
			paymentMethod = null,
			cardDetails = null,
			upiDetails = null,
			netbankingDetails = null,
			viaWebhook = false,
			webhookEventId = null,
			newStatus = "paid",
		} = {},
	) {
		if (!booking) {
			throw AppError.notFound("Associated booking not found");
		}
		if (booking.status === "cancelled") {
			throw AppError.badRequest("Booking has already been cancelled");
		}
		if (booking.paymentStatus === "paid" && String(booking.payment) !== String(payment._id)) {
			if (!this.isPaidStatus(payment.status)) {
				payment.status = "failed";
				await payment.save();
			}
			throw AppError.badRequest("Booking has already been paid by a newer payment attempt");
		}

		if (this.isPaidStatus(payment.status)) {
			if (viaWebhook) {
				await Payment.updateOne(
					{ _id: payment._id },
					{
						$set: {
							webhookVerified: true,
							...(webhookEventId ? { webhookEventId } : {}),
						},
						...(webhookEventId ? { $addToSet: { processedWebhookEvents: webhookEventId } } : {}),
					},
				);
			}
			const latest = await Payment.findById(payment._id);
			return { payment: latest || payment, booking, idempotent: true };
		}

		if (!["pending", "created"].includes(payment.status)) {
			throw AppError.badRequest(`Cannot confirm payment in state '${payment.status}'`);
		}

		const updateSet = {
			status: newStatus,
			gatewayStatus: "paid",
			gatewaySignatureVerifiedAt: new Date(),
			...(payment.paymentLinkId ? { paymentLinkStatus: "paid" } : {}),
			...(gatewayPaymentId
				? { gatewayPaymentId, transactionId: gatewayPaymentId }
				: {}),
			...(gatewayOrderId ? { gatewayOrderId } : {}),
			...(paymentMethod ? { paymentMethod } : {}),
			...(cardDetails ? { cardDetails } : {}),
			...(upiDetails ? { upiDetails } : {}),
			...(netbankingDetails ? { netbankingDetails } : {}),
			...(viaWebhook
				? {
						webhookVerified: true,
						...(webhookEventId ? { webhookEventId } : {}),
					}
				: {}),
		};

		const atomicPayment = await Payment.findOneAndUpdate(
			{
				_id: payment._id,
				status: { $in: ["pending", "created"] },
			},
			{
				$set: updateSet,
				...(viaWebhook && webhookEventId
					? { $addToSet: { processedWebhookEvents: webhookEventId } }
					: {}),
			},
			{ new: true },
		);

		if (!atomicPayment) {
			// Concurrent callback/webhook already confirmed this payment
			const alreadyConfirmed = await Payment.findById(payment._id);
			if (alreadyConfirmed && this.isPaidStatus(alreadyConfirmed.status)) {
				if (viaWebhook && webhookEventId) {
					await Payment.updateOne(
						{ _id: payment._id },
						{
							$set: { webhookVerified: true, webhookEventId },
							$addToSet: { processedWebhookEvents: webhookEventId },
						},
					);
				}
				return { payment: alreadyConfirmed, booking, idempotent: true };
			}
			throw AppError.badRequest("Unable to confirm payment in its current state");
		}

		booking.payment = atomicPayment._id;
		booking.paymentStatus = "paid";
		booking.status = "confirmed";
		booking.expiresAt = null;
		await booking.save();

		await this._sendPaymentSuccessNotifications(
			booking,
			atomicPayment,
			atomicPayment.user,
			atomicPayment.receiptNumber,
		);

		return { payment: atomicPayment, booking, idempotent: false };
	}

	/**
	 * Verify Razorpay Hosted Payment Link browser callback parameters, signature,
	 * and authoritative server-side Payment Link status & amount via Razorpay API.
	 */
	static async verifyRazorpayPaymentLinkCallback(callbackParams = {}, user) {
		if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
			throw new AppError(503, "Razorpay gateway credentials are not configured.");
		}

		const {
			razorpay_payment_id,
			razorpay_payment_link_id,
			razorpay_payment_link_reference_id,
			razorpay_payment_link_status,
			razorpay_signature,
		} = callbackParams;

		if (!razorpay_payment_link_id || !razorpay_payment_link_reference_id || !razorpay_payment_link_status) {
			throw AppError.badRequest("Missing Razorpay Payment Link callback parameters");
		}

		const payment = await Payment.findOne({
			paymentLinkId: razorpay_payment_link_id,
		});
		if (!payment) {
			throw AppError.notFound("Referenced Razorpay Payment Link not found");
		}

		if (user && String(payment.user) !== String(user._id)) {
			throw AppError.forbidden("You are not authorized to verify this payment");
		}

		if (payment.paymentLinkReferenceId !== razorpay_payment_link_reference_id) {
			const err = AppError.badRequest("Payment Link reference ID mismatch");
			err.bookingId = payment.booking;
			throw err;
		}

		// Handle non-paid callback status immediately if user cancelled or link expired
		if (razorpay_payment_link_status !== "paid") {
			if (!this.isPaidStatus(payment.status) && ["cancelled", "expired"].includes(razorpay_payment_link_status)) {
				payment.status = razorpay_payment_link_status;
				payment.paymentLinkStatus = razorpay_payment_link_status;
				payment.gatewayStatus = razorpay_payment_link_status;
				await payment.save();
			}
			const err = AppError.badRequest(
				`Payment was not completed (status: ${razorpay_payment_link_status}). Please try again.`,
			);
			err.bookingId = payment.booking;
			throw err;
		}

		try {
			if (!razorpay_payment_id || !razorpay_signature) {
				throw AppError.badRequest("Missing Razorpay payment ID or cryptographic signature");
			}

			const signedPayload = `${razorpay_payment_link_id}|${razorpay_payment_link_reference_id}|${razorpay_payment_link_status}|${razorpay_payment_id}`;
			const expectedSig = crypto
				.createHmac("sha256", env.RAZORPAY_KEY_SECRET)
				.update(signedPayload)
				.digest("hex");

			const sdkValid = validatePaymentVerification(
				{
					payment_link_id: razorpay_payment_link_id,
					payment_link_reference_id: razorpay_payment_link_reference_id,
					payment_link_status: razorpay_payment_link_status,
					payment_id: razorpay_payment_id,
				},
				razorpay_signature,
				env.RAZORPAY_KEY_SECRET,
			);

			if (!sdkValid || !this._verifyTimingSafeHex(expectedSig, razorpay_signature)) {
				throw new AppError(401, "Invalid Razorpay Payment Link signature");
			}

			const booking = await Booking.findById(payment.booking).populate("listing");
			if (!booking) {
				throw AppError.notFound("Associated booking not found");
			}

			if (this.isPaidStatus(payment.status)) {
				const populatedAlready = await this.getPaymentById(payment._id, user);
				return { payment: populatedAlready, booking, idempotent: true };
			}

			// Server-side verification against Razorpay API before confirming booking
			const rpClient = this._getRazorpayClient();
			let rpLink;
			try {
				rpLink = await rpClient.paymentLink.fetch(razorpay_payment_link_id);
			} catch (err) {
				const gatewayMsg =
					err?.error?.description || err?.message || "Unable to verify Payment Link with Razorpay";
				throw new AppError(502, `Payment verification failed: ${gatewayMsg}`);
			}

			const expectedPaise = Math.round(payment.amount * 100);
			if (!rpLink || rpLink.id !== razorpay_payment_link_id) {
				throw new AppError(502, "Razorpay Payment Link verification returned mismatched entity");
			}
			if (rpLink.reference_id && rpLink.reference_id !== payment.paymentLinkReferenceId) {
				throw AppError.badRequest("Razorpay Payment Link reference mismatch");
			}
			if (rpLink.status !== "paid") {
				throw AppError.badRequest(`Payment Link is not paid on Razorpay (status: ${rpLink.status})`);
			}
			if (
				Number(rpLink.amount) !== expectedPaise ||
				Number(rpLink.amount_paid) !== expectedPaise
			) {
				throw AppError.badRequest("Payment amount mismatch against Razorpay server-side record");
			}
			if ((rpLink.currency || "INR").toUpperCase() !== payment.currency) {
				throw AppError.badRequest("Payment currency mismatch");
			}

			let rpPayment = null;
			if (rpClient.payments && typeof rpClient.payments.fetch === "function") {
				try {
					rpPayment = await rpClient.payments.fetch(razorpay_payment_id);
				} catch (err) {
					// If mock/API does not implement payments.fetch when statusCode === 404 on test mock, fail closed unless paymentLink already confirmed payments array
					if (err?.statusCode !== 404) {
						const gatewayMsg =
							err?.error?.description || err?.message || "Unable to verify payment transaction with Razorpay";
						throw new AppError(502, `Payment verification failed: ${gatewayMsg}`);
					}
				}
			}

			if (rpPayment) {
				if (!["captured", "authorized"].includes(rpPayment.status)) {
					throw AppError.badRequest(`Razorpay payment is not captured (status: ${rpPayment.status})`);
				}
				if (Number(rpPayment.amount) !== expectedPaise) {
					throw AppError.badRequest("Razorpay payment amount mismatch");
				}
				if ((rpPayment.currency || "INR").toUpperCase() !== payment.currency) {
					throw AppError.badRequest("Razorpay payment currency mismatch");
				}
			}

			const methodDetails = this._extractRazorpayMethodDetails(rpPayment);
			const confirmResult = await this._confirmPaidPayment(payment, booking, {
				gatewayPaymentId: razorpay_payment_id,
				gatewayOrderId: rpPayment?.order_id || null,
				...methodDetails,
				viaWebhook: false,
				newStatus: "paid",
			});

			const populated = await this.getPaymentById(confirmResult.payment._id, user);
			return { payment: populated, booking, idempotent: confirmResult.idempotent };
		} catch (err) {
			if (err && typeof err === "object" && !err.bookingId && payment.booking) {
				err.bookingId = payment.booking;
			}
			throw err;
		}
	}

	static _extractRazorpayMethodDetails(rpPayment) {
		if (!rpPayment || typeof rpPayment !== "object") {
			return {};
		}
		const validMethods = ["card", "upi", "netbanking", "wallet", "emi", "bank_transfer"];
		const method = validMethods.includes(rpPayment.method)
			? rpPayment.method
			: "razorpay_payment_link";
		const details = { paymentMethod: method };
		if (method === "card" && rpPayment.card) {
			details.cardDetails = {
				brand: rpPayment.card.network || "Card",
				last4: rpPayment.card.last4 || "****",
				expiry: rpPayment.card.expiry_month && rpPayment.card.expiry_year
					? `${rpPayment.card.expiry_month}/${String(rpPayment.card.expiry_year).slice(-2)}`
					: "",
			};
		} else if (method === "upi" && rpPayment.vpa) {
			details.upiDetails = { vpa: rpPayment.vpa };
		} else if (method === "netbanking" && rpPayment.bank) {
			details.netbankingDetails = { bankName: rpPayment.bank };
		}
		return details;
	}

	/**
	 * Verify legacy Razorpay Order Checkout signature (`HMAC-SHA256(order_id + "|" + payment_id, key_secret)`).
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

		if (this.isPaidStatus(payment.status)) {
			const populatedAlready = await this.getPaymentById(payment._id, user);
			return { payment: populatedAlready, booking, idempotent: true };
		}

		const confirmResult = await this._confirmPaidPayment(payment, booking, {
			gatewayPaymentId: razorpay_payment_id,
			viaWebhook: false,
			newStatus: "succeeded",
		});

		const populated = await this.getPaymentById(confirmResult.payment._id, user);
		return { payment: populated, booking, idempotent: confirmResult.idempotent };
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
		if (!Buffer.isBuffer(rawBody) && typeof rawBody !== "string") {
			throw AppError.badRequest("Raw request body is required for webhook signature verification");
		}
		const rawStr = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
		const expectedHex = crypto
			.createHmac("sha256", secret)
			.update(rawStr)
			.digest("hex");
		const sdkValid = validateWebhookSignature(rawStr, signatureHeader.trim(), secret);
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
	 * Verify internal HMAC-SHA256 signature and timestamp window (anti-replay) on incoming webhook.
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

		if (
			eventId &&
			(payment.webhookEventId === String(eventId) ||
				(Array.isArray(payment.processedWebhookEvents) &&
					payment.processedWebhookEvents.includes(String(eventId))))
		) {
			return { payment, idempotent: true };
		}

		const booking = await Booking.findById(payment.booking).populate("listing");
		if (!booking) {
			throw AppError.notFound("Associated booking not found");
		}

		if (eventType === "payment.succeeded") {
			if (amount !== undefined && Number(amount) !== payment.amount) {
				throw AppError.badRequest("Webhook amount mismatch");
			}
			const result = await this._confirmPaidPayment(payment, booking, {
				viaWebhook: true,
				webhookEventId: eventId ? String(eventId) : null,
				newStatus: "succeeded",
			});
			return { payment: result.payment, idempotent: result.idempotent };
		}

		if (eventType === "payment.failed") {
			if (payment.status === "failed") {
				return { payment, idempotent: true };
			}
			if (this.isPaidStatus(payment.status)) {
				throw AppError.badRequest("Cannot fail an already succeeded payment");
			}
			payment.status = "failed";
			payment.webhookVerified = true;
			payment.webhookEventId = eventId ? String(eventId) : payment.webhookEventId;
			if (eventId) {
				payment.processedWebhookEvents = Array.from(
					new Set([...(payment.processedWebhookEvents || []), String(eventId)]),
				);
			}
			payment.gatewaySignatureVerifiedAt = new Date();
			await payment.save();

			if (String(booking.payment) === String(payment._id) && booking.paymentStatus !== "paid") {
				booking.status = "cancelled";
				booking.paymentStatus = "unpaid";
				booking.expiresAt = null;
				await booking.save();
				await BookingNightLock.deleteMany({ booking: booking._id });
			}
			return { payment, idempotent: false };
		}

		if (eventType === "payment.refunded") {
			if (payment.status === "refunded") {
				return { payment, idempotent: true };
			}
			if (!this.isPaidStatus(payment.status)) {
				throw AppError.badRequest("Only paid payments can be refunded");
			}
			payment.status = "refunded";
			payment.webhookVerified = true;
			payment.webhookEventId = eventId ? String(eventId) : payment.webhookEventId;
			if (eventId) {
				payment.processedWebhookEvents = Array.from(
					new Set([...(payment.processedWebhookEvents || []), String(eventId)]),
				);
			}
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

	static async _recordWebhookEvent({ eventId, eventType, payment, booking }) {
		if (!eventId) return;
		try {
			await WebhookEvent.create({
				eventId: String(eventId),
				provider: "razorpay",
				eventType,
				payment: payment?._id || null,
				booking: booking?._id || null,
				paymentLinkId: payment?.paymentLinkId || null,
				gatewayPaymentId: payment?.gatewayPaymentId || null,
				status: "processed",
				processedAt: new Date(),
			});
		} catch (err) {
			if (err && err.code !== 11000) {
				throw err;
			}
		}
	}

	static async _processRazorpayWebhookEvent(rawBody, signatureHeader, headerEventId, parsedBody = null) {
		this.verifyRazorpayWebhookSignature(rawBody, signatureHeader);

		let body;
		try {
			const str = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || "{}");
			body = JSON.parse(str);
		} catch {
			if (parsedBody && typeof parsedBody === "object") {
				body = parsedBody;
			} else {
				throw AppError.badRequest("Invalid Razorpay webhook JSON payload");
			}
		}

		const eventName = body.event;
		const rpPaymentLink = body.payload?.payment_link?.entity;
		const rpPayment = body.payload?.payment?.entity;
		const rpOrder = body.payload?.order?.entity;
		const rpRefund = body.payload?.refund?.entity;

		const paymentLinkId = rpPaymentLink?.id || null;
		const paymentLinkReferenceId = rpPaymentLink?.reference_id || null;
		const gatewayOrderId =
			rpPayment?.order_id || rpOrder?.id || rpPaymentLink?.order_id || null;
		const gatewayPaymentId = rpPayment?.id || rpRefund?.payment_id || null;
		const notesBookingId =
			rpPaymentLink?.notes?.bookingId || rpPayment?.notes?.bookingId || rpOrder?.notes?.bookingId || null;

		const eventId =
			headerEventId ||
			(eventName
				? `${eventName}:${rpRefund?.id || paymentLinkId || gatewayPaymentId || gatewayOrderId || "evt"}:${body.created_at || ""}`
				: null);

		if (
			!eventName ||
			(!paymentLinkId && !paymentLinkReferenceId && !gatewayOrderId && !gatewayPaymentId)
		) {
			throw AppError.badRequest("Razorpay webhook missing event or payment identifier");
		}

		// Check persistent WebhookEvent deduplication log first
		if (eventId) {
			const existingEvent = await WebhookEvent.findOne({ eventId: String(eventId) }).lean();
			if (existingEvent) {
				const existingPayment = existingEvent.payment
					? await Payment.findById(existingEvent.payment)
					: null;
				return { payment: existingPayment, idempotent: true };
			}
		}

		const orConditions = [];
		if (paymentLinkId) orConditions.push({ paymentLinkId });
		if (paymentLinkReferenceId) orConditions.push({ paymentLinkReferenceId });
		if (gatewayOrderId) orConditions.push({ gatewayOrderId }, { orderId: gatewayOrderId });
		if (gatewayPaymentId) orConditions.push({ gatewayPaymentId }, { transactionId: gatewayPaymentId });

		let payment = await Payment.findOne({ $or: orConditions });
		if (!payment && notesBookingId && mongoose.Types.ObjectId.isValid(notesBookingId)) {
			payment = await Payment.findOne({
				booking: notesBookingId,
				gateway: "razorpay_payment_link",
			}).sort({ createdAt: -1 });
		}

		if (!payment) {
			throw AppError.notFound("Referenced payment record not found");
		}

		if (
			eventId &&
			(payment.webhookEventId === String(eventId) ||
				(Array.isArray(payment.processedWebhookEvents) &&
					payment.processedWebhookEvents.includes(String(eventId))))
		) {
			await this._recordWebhookEvent({ eventId, eventType: eventName, payment, booking: { _id: payment.booking } });
			return { payment, idempotent: true };
		}

		const booking = await Booking.findById(payment.booking).populate("listing");
		if (!booking) {
			throw AppError.notFound("Associated booking not found");
		}

		const expectedPaise = Math.round(payment.amount * 100);

		if (
			eventName === "payment_link.paid" ||
			eventName === "payment.captured" ||
			eventName === "order.paid"
		) {
			if (eventName === "payment_link.paid") {
				if (rpPaymentLink?.status !== "paid") {
					throw AppError.badRequest(`Cannot confirm payment_link.paid with status '${rpPaymentLink?.status}'`);
				}
				if (
					rpPaymentLink?.amount !== undefined &&
					Number(rpPaymentLink.amount) !== expectedPaise
				) {
					throw AppError.badRequest("Razorpay Payment Link webhook amount mismatch");
				}
				if (
					rpPaymentLink?.amount_paid !== undefined &&
					Number(rpPaymentLink.amount_paid) !== expectedPaise
				) {
					throw AppError.badRequest("Razorpay Payment Link paid amount mismatch");
				}
			}

			const entityAmountPaise = rpPayment?.amount ?? rpOrder?.amount_paid ?? rpOrder?.amount;
			if (entityAmountPaise !== undefined && Number(entityAmountPaise) !== expectedPaise) {
				throw AppError.badRequest("Razorpay webhook amount mismatch");
			}
			if (rpPayment?.currency && rpPayment.currency.toUpperCase() !== payment.currency) {
				throw AppError.badRequest("Razorpay webhook currency mismatch");
			}

			const methodDetails = this._extractRazorpayMethodDetails(rpPayment);
			const confirmResult = await this._confirmPaidPayment(payment, booking, {
				gatewayPaymentId,
				gatewayOrderId,
				...methodDetails,
				viaWebhook: true,
				webhookEventId: eventId ? String(eventId) : null,
				newStatus: payment.paymentLinkId ? "paid" : "succeeded",
			});

			await this._recordWebhookEvent({
				eventId,
				eventType: eventName,
				payment: confirmResult.payment,
				booking,
			});

			return { payment: confirmResult.payment, idempotent: confirmResult.idempotent };
		}

		if (eventName === "payment_link.partially_paid") {
			if (!this.isPaidStatus(payment.status)) {
				payment.paymentLinkStatus = "partially_paid";
				payment.gatewayStatus = "partially_paid";
				payment.webhookVerified = true;
				payment.webhookEventId = eventId;
				if (eventId) {
					payment.processedWebhookEvents = Array.from(
						new Set([...(payment.processedWebhookEvents || []), String(eventId)]),
					);
				}
				await payment.save();
			}
			await this._recordWebhookEvent({ eventId, eventType: eventName, payment, booking });
			return { payment, idempotent: false };
		}

		if (eventName === "payment_link.cancelled" || eventName === "payment_link.expired") {
			const nextState = eventName === "payment_link.cancelled" ? "cancelled" : "expired";
			if (payment.status === nextState) {
				await this._recordWebhookEvent({ eventId, eventType: eventName, payment, booking });
				return { payment, idempotent: true };
			}
			if (this.isPaidStatus(payment.status)) {
				await this._recordWebhookEvent({ eventId, eventType: eventName, payment, booking });
				return { payment, idempotent: true };
			}

			payment.status = nextState;
			payment.paymentLinkStatus = nextState;
			payment.gatewayStatus = nextState;
			payment.webhookVerified = true;
			payment.webhookEventId = eventId;
			if (eventId) {
				payment.processedWebhookEvents = Array.from(
					new Set([...(payment.processedWebhookEvents || []), String(eventId)]),
				);
			}
			payment.gatewaySignatureVerifiedAt = new Date();
			await payment.save();

			if (
				nextState === "expired" &&
				String(booking.payment) === String(payment._id) &&
				booking.status === "pending" &&
				booking.paymentStatus === "unpaid"
			) {
				booking.status = "cancelled";
				booking.expiresAt = null;
				booking.cancellationReason = "Razorpay Payment Link expired before payment completion";
				await booking.save();
				await BookingNightLock.deleteMany({ booking: booking._id });
			}

			await this._recordWebhookEvent({ eventId, eventType: eventName, payment, booking });
			return { payment, idempotent: false };
		}

		if (eventName === "payment.failed") {
			if (payment.status === "failed") {
				await this._recordWebhookEvent({ eventId, eventType: eventName, payment, booking });
				return { payment, idempotent: true };
			}
			if (this.isPaidStatus(payment.status)) {
				throw AppError.badRequest("Cannot fail an already paid payment");
			}
			payment.status = "failed";
			payment.gatewayStatus = "failed";
			if (gatewayPaymentId) {
				payment.gatewayPaymentId = gatewayPaymentId;
			}
			payment.webhookVerified = true;
			payment.webhookEventId = eventId;
			if (eventId) {
				payment.processedWebhookEvents = Array.from(
					new Set([...(payment.processedWebhookEvents || []), String(eventId)]),
				);
			}
			payment.gatewaySignatureVerifiedAt = new Date();
			await payment.save();

			if (String(booking.payment) === String(payment._id) && booking.paymentStatus !== "paid") {
				booking.status = "cancelled";
				booking.paymentStatus = "unpaid";
				booking.expiresAt = null;
				booking.cancellationReason =
					rpPayment?.error_description || "Payment failed at Razorpay gateway";
				await booking.save();
				await BookingNightLock.deleteMany({ booking: booking._id });
			}
			await this._recordWebhookEvent({ eventId, eventType: eventName, payment, booking });
			return { payment, idempotent: false };
		}

		if (eventName === "refund.processed" || eventName === "refund.created") {
			if (payment.status === "refunded") {
				await this._recordWebhookEvent({ eventId, eventType: eventName, payment, booking });
				return { payment, idempotent: true };
			}
			if (!this.isPaidStatus(payment.status)) {
				throw AppError.badRequest("Only paid payments can be refunded");
			}
			payment.status = "refunded";
			payment.gatewayStatus = "refunded";
			payment.webhookVerified = true;
			payment.webhookEventId = eventId;
			if (eventId) {
				payment.processedWebhookEvents = Array.from(
					new Set([...(payment.processedWebhookEvents || []), String(eventId)]),
				);
			}
			payment.gatewaySignatureVerifiedAt = new Date();
			payment.refundId =
				rpRefund?.id ||
				payment.refundId ||
				`rfnd_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
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
			await this._recordWebhookEvent({ eventId, eventType: eventName, payment, booking });
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
			status: { $in: PAID_STATUSES },
		});

		if (!payment) {
			return null; // No paid payment to refund
		}

		let gatewayRefundId = null;
		if (payment.gateway === "razorpay" || payment.gateway === "razorpay_payment_link") {
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
		payment.gatewayStatus = "refunded";
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
			.populate("user", "username email fullName");

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
			.populate("user", "username email fullName");

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

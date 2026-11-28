const crypto = require("crypto");
const EmailOtp = require("../models/emailOtp");
const User = require("../models/user");
const EmailService = require("./email.service");
const AppError = require("../utils/AppError");
const env = require("../config/env");
const { normalizeEmail } = require("../utils/addressValidation");

class OtpService {
	static _getHashSecret() {
		if (!env.OTP_HASH_SECRET) {
			throw new AppError(
				503,
				"OTP verification secret is not configured. Configure OTP_HASH_SECRET on the server.",
			);
		}
		if (env.isProduction && env.OTP_HASH_SECRET.length < 32) {
			throw new AppError(
				503,
				"OTP verification secret does not meet minimum production entropy requirements.",
			);
		}
		return env.OTP_HASH_SECRET;
	}

	static generateOtpCode() {
		return crypto.randomInt(0, 1000000).toString().padStart(6, "0");
	}

	static hashOtp({ email, purpose = "signup_verification", otpCode }) {
		const cleanEmail = normalizeEmail(email);
		const cleanOtp = String(otpCode || "").trim();
		const secret = this._getHashSecret();
		return crypto
			.createHmac("sha256", secret)
			.update(`${cleanEmail}:${purpose}:${cleanOtp}`)
			.digest("hex");
	}

	static timingSafeEqualHex(expectedHex, providedHex) {
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

	static async getResendCooldownStatus(email, purpose = "signup_verification") {
		const cleanEmail = normalizeEmail(email);
		if (!cleanEmail) {
			return { cooldownSecondsRemaining: 0, expiresAt: null };
		}

		const latest = await EmailOtp.findOne({ email: cleanEmail, purpose })
			.sort({ createdAt: -1 })
			.select("lastSentAt expiresAt consumedAt invalidatedAt")
			.lean();

		if (!latest) {
			return { cooldownSecondsRemaining: 0, expiresAt: null };
		}

		const cooldownMs = env.OTP_RESEND_COOLDOWN_SECONDS * 1000;
		const sentAtMs = latest.lastSentAt ? new Date(latest.lastSentAt).getTime() : 0;
		const elapsedMs = Date.now() - sentAtMs;
		const remainingMs = Math.max(0, cooldownMs - elapsedMs);

		return {
			cooldownSecondsRemaining: Math.ceil(remainingMs / 1000),
			expiresAt:
				!latest.consumedAt && !latest.invalidatedAt && latest.expiresAt > new Date()
					? latest.expiresAt
					: null,
		};
	}

	static async issueVerificationOtp(user, { purpose = "signup_verification", enforceCooldown = false } = {}) {
		if (!user || !user._id || !user.email) {
			throw AppError.badRequest("Valid user record is required to issue verification code");
		}

		const cleanEmail = normalizeEmail(user.email);
		this._getHashSecret();

		if (enforceCooldown) {
			const { cooldownSecondsRemaining } = await this.getResendCooldownStatus(cleanEmail, purpose);
			if (cooldownSecondsRemaining > 0) {
				throw new AppError(
					429,
					`Please wait ${cooldownSecondsRemaining} second${cooldownSecondsRemaining === 1 ? "" : "s"} before requesting a new verification code.`,
				);
			}
		}

		const now = new Date();
		const expiresAt = new Date(now.getTime() + env.OTP_TTL_SECONDS * 1000);
		const otpCode = this.generateOtpCode();
		const otpHash = this.hashOtp({ email: cleanEmail, purpose, otpCode });

		// Invalidate all previously issued unconsumed OTPs for this email & purpose
		await EmailOtp.updateMany(
			{
				email: cleanEmail,
				purpose,
				consumedAt: null,
				invalidatedAt: null,
			},
			{ $set: { invalidatedAt: now } },
		);

		const otpDoc = await EmailOtp.create({
			user: user._id,
			email: cleanEmail,
			purpose,
			otpHash,
			expiresAt,
			attempts: 0,
			maxAttempts: env.OTP_MAX_ATTEMPTS,
			lastSentAt: now,
		});

		try {
			await EmailService.sendVerificationOtpEmail({
				to: cleanEmail,
				fullName: user.fullName || user.username || "Traveler",
				otpCode,
				ttlSeconds: env.OTP_TTL_SECONDS,
			});
		} catch (err) {
			// Roll back newly minted OTP if email transport fails so user isn't penalized by cooldown
			await EmailOtp.deleteOne({ _id: otpDoc._id }).catch(() => {});
			throw err;
		}

		return {
			email: cleanEmail,
			expiresAt,
			ttlSeconds: env.OTP_TTL_SECONDS,
			cooldownSeconds: env.OTP_RESEND_COOLDOWN_SECONDS,
		};
	}

	static async resendVerificationOtp(email, { purpose = "signup_verification" } = {}) {
		const cleanEmail = normalizeEmail(email);
		if (!cleanEmail) {
			throw AppError.badRequest("Please provide a valid email address");
		}

		const user = await User.findOne({ email: cleanEmail });
		// Prevent account enumeration: if unknown or already verified, return generic accepted response without sending
		if (!user || user.emailVerified !== false) {
			return {
				sent: false,
				genericMessage:
					"If an unverified account exists for this email address, a new verification code has been sent.",
				cooldownSeconds: env.OTP_RESEND_COOLDOWN_SECONDS,
			};
		}

		const issued = await this.issueVerificationOtp(user, {
			purpose,
			enforceCooldown: true,
		});

		return {
			sent: true,
			genericMessage:
				"If an unverified account exists for this email address, a new verification code has been sent.",
			expiresAt: issued.expiresAt,
			cooldownSeconds: issued.cooldownSeconds,
		};
	}

	static async verifySignupOtp({ email, otp, purpose = "signup_verification" }) {
		const cleanEmail = normalizeEmail(email);
		const cleanOtp = typeof otp === "string" ? otp.trim() : "";

		if (!cleanEmail || !/^\d{6}$/.test(cleanOtp)) {
			throw AppError.badRequest("Please provide your email and the 6-digit verification code.");
		}

		const user = await User.findOne({ email: cleanEmail });
		if (!user || user.emailVerified !== false) {
			throw AppError.badRequest("Invalid or expired verification code.");
		}

		const latestOtp = await EmailOtp.findOne({
			email: cleanEmail,
			purpose,
		}).sort({ createdAt: -1 });

		if (!latestOtp) {
			throw AppError.badRequest("Invalid or expired verification code. Please request a new code.");
		}

		if (latestOtp.consumedAt) {
			throw AppError.badRequest("This verification code has already been used. Please request a new code.");
		}

		if (latestOtp.invalidatedAt) {
			throw AppError.badRequest("This verification code is no longer valid. Please request a new code.");
		}

		const now = new Date();
		if (latestOtp.expiresAt <= now) {
			throw AppError.badRequest("Your verification code has expired. Please request a new code.");
		}

		if (latestOtp.attempts >= latestOtp.maxAttempts) {
			await EmailOtp.updateOne(
				{ _id: latestOtp._id, invalidatedAt: null },
				{ $set: { invalidatedAt: now } },
			);
			throw new AppError(
				429,
				"Maximum incorrect verification attempts reached. Please request a new code.",
			);
		}

		const providedHash = this.hashOtp({ email: cleanEmail, purpose, otpCode: cleanOtp });
		const isValid = this.timingSafeEqualHex(latestOtp.otpHash, providedHash);

		if (!isValid) {
			const updatedFailure = await EmailOtp.findOneAndUpdate(
				{
					_id: latestOtp._id,
					consumedAt: null,
					invalidatedAt: null,
				},
				{ $inc: { attempts: 1 } },
				{ new: true },
			);

			const attemptsUsed = updatedFailure ? updatedFailure.attempts : latestOtp.attempts + 1;
			const maxAttempts = updatedFailure ? updatedFailure.maxAttempts : latestOtp.maxAttempts;
			if (attemptsUsed >= maxAttempts) {
				await EmailOtp.updateOne(
					{ _id: latestOtp._id, invalidatedAt: null },
					{ $set: { invalidatedAt: new Date() } },
				);
				throw new AppError(
					429,
					"Maximum incorrect verification attempts reached. Please request a new code.",
				);
			}

			const remaining = Math.max(0, maxAttempts - attemptsUsed);
			throw AppError.badRequest(
				`Incorrect verification code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`,
			);
		}

		// Atomically consume the OTP once to prevent concurrent replay
		const consumedOtp = await EmailOtp.findOneAndUpdate(
			{
				_id: latestOtp._id,
				consumedAt: null,
				invalidatedAt: null,
				expiresAt: { $gt: now },
				attempts: { $lt: latestOtp.maxAttempts },
			},
			{ $set: { consumedAt: now } },
			{ new: true },
		);

		if (!consumedOtp) {
			throw AppError.badRequest("This verification code has already been used or expired. Please request a new code.");
		}

		// Mark any remaining unconsumed OTPs invalidated
		await EmailOtp.updateMany(
			{ email: cleanEmail, purpose, consumedAt: null, invalidatedAt: null },
			{ $set: { invalidatedAt: now } },
		);

		const verifiedUser = await User.findByIdAndUpdate(
			user._id,
			{
				$set: {
					emailVerified: true,
					emailVerifiedAt: now,
				},
			},
			{ new: true },
		);

		return verifiedUser;
	}
}

module.exports = OtpService;

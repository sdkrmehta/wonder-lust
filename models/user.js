const crypto = require("crypto");
const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const passportLocalMongoose = require("passport-local-mongoose");
const plmErrors = require("passport-local-mongoose/lib/errors");

const LEGACY_KDF = {
	version: 1,
	iterations: 25000,
	keylen: 512,
	digest: "sha256",
};

const MODERN_KDF = {
	version: 2,
	iterations: 600000,
	keylen: 32,
	digest: "sha256",
	saltBytes: 32,
};

const userSchema = new Schema(
	{
		email: {
			type: String,
			required: [true, "Email is required"],
			unique: true,
			lowercase: true,
			trim: true,
			match: [/^\S+@\S+\.\S+$/, "Please provide a valid email address"],
		},
		fullName: {
			type: String,
			trim: true,
			default: "",
		},
		avatar: {
			url: {
				type: String,
				default: "",
			},
			filename: {
				type: String,
				default: "",
			},
		},
		bio: {
			type: String,
			trim: true,
			default: "",
		},
		phone: {
			type: String,
			trim: true,
			default: "",
		},
		address: {
			type: String,
			trim: true,
			default: "",
		},
		city: {
			type: String,
			trim: true,
			default: "",
		},
		country: {
			type: String,
			trim: true,
			default: "India",
		},
		role: {
			type: String,
			enum: ["traveler", "host", "admin"],
			default: "traveler",
		},
		isSuperhost: {
			type: Boolean,
			default: false,
		},
		passwordKdfVersion: {
			type: Number,
			default: 1,
		},
		passwordIterations: {
			type: Number,
			default: LEGACY_KDF.iterations,
		},
		passwordKeylen: {
			type: Number,
			default: LEGACY_KDF.keylen,
		},
		passwordDigest: {
			type: String,
			default: LEGACY_KDF.digest,
		},
		sessionVersion: {
			type: Number,
			default: 1,
		},
	},
	{ timestamps: true },
);

// Directory and role lookup indexes
userSchema.index({ role: 1 });
userSchema.index({ isSuperhost: 1 });
userSchema.index({ createdAt: -1 });

function stripSensitiveFields(_doc, ret) {
	delete ret.hash;
	delete ret.salt;
	delete ret.attempts;
	delete ret.last;
	delete ret.passwordKdfVersion;
	delete ret.passwordIterations;
	delete ret.passwordKeylen;
	delete ret.passwordDigest;
	delete ret.sessionVersion;
	delete ret.__v;
	return ret;
}

userSchema.set("toJSON", { transform: stripSensitiveFields });
userSchema.set("toObject", { transform: stripSensitiveFields });

userSchema.plugin(passportLocalMongoose, {
	limitAttempts: true,
	maxAttempts: 10,
	interval: 100,
	maxInterval: 60 * 1000,
	unlockInterval: 15 * 60 * 1000,
	tooManyAttemptsError: "Account temporarily locked due to failed login attempts. Try again shortly.",
});

function pbkdf2Async(password, salt, iterations, keylen, digest) {
	return new Promise((resolve, reject) => {
		crypto.pbkdf2(password, salt, iterations, keylen, digest, (err, derivedKey) => {
			if (err) return reject(err);
			resolve(derivedKey);
		});
	});
}

// Upgrade setPassword to always hash new credentials with 600,000 PBKDF2-HMAC-SHA256 iterations
userSchema.methods.setPassword = function (password, cb) {
	const promise = Promise.resolve().then(async () => {
		if (!password || typeof password !== "string") {
			throw new plmErrors.MissingPasswordError("No password was given");
		}
		const salt = crypto.randomBytes(MODERN_KDF.saltBytes).toString("hex");
		const derived = await pbkdf2Async(
			password,
			salt,
			MODERN_KDF.iterations,
			MODERN_KDF.keylen,
			MODERN_KDF.digest,
		);
		this.set("salt", salt);
		this.set("hash", derived.toString("hex"));
		this.passwordKdfVersion = MODERN_KDF.version;
		this.passwordIterations = MODERN_KDF.iterations;
		this.passwordKeylen = MODERN_KDF.keylen;
		this.passwordDigest = MODERN_KDF.digest;
		return this;
	});

	if (!cb) return promise;
	promise.then((res) => cb(null, res)).catch((err) => cb(err));
};

// Backward-compatible authenticate supporting both v1 (25k) and v2 (600k) with lazy v1->v2 migration
userSchema.methods.authenticate = function (password, cb) {
	const promise = Promise.resolve().then(async () => {
		if (!password || typeof password !== "string") {
			return {
				user: false,
				error: new plmErrors.MissingPasswordError("No password was given"),
			};
		}

		let userDoc = this;
		if (!userDoc.get("salt") || !userDoc.get("hash")) {
			userDoc = await this.constructor.findByUsername(this.get("username"), true);
			if (!userDoc) {
				return {
					user: false,
					error: new plmErrors.IncorrectUsernameError("Password or username is incorrect"),
				};
			}
		}

		const attempts = Number(userDoc.get("attempts") || 0);
		const lastMs = userDoc.get("last") ? new Date(userDoc.get("last")).getTime() : 0;
		const unlockInterval = 15 * 60 * 1000;
		const maxAttempts = 10;

		const backoff = Math.min(Math.pow(100, Math.log(attempts + 1)), 60 * 1000);
		if (attempts >= 3 && Date.now() - lastMs < backoff) {
			userDoc.set("last", Date.now());
			await userDoc.save();
			return {
				user: false,
				error: new plmErrors.AttemptTooSoonError("Account is currently locked. Try again later"),
			};
		}

		if (attempts >= maxAttempts) {
			if (Date.now() - lastMs > unlockInterval) {
				userDoc.set("attempts", 0);
				userDoc.set("last", Date.now());
				await userDoc.save();
			} else {
				return {
					user: false,
					error: new plmErrors.TooManyAttemptsError("Account temporarily locked due to failed login attempts. Try again shortly."),
				};
			}
		}

		const storedSalt = userDoc.get("salt");
		const storedHash = userDoc.get("hash");
		if (!storedSalt || !storedHash) {
			return {
				user: false,
				error: new plmErrors.NoSaltValueStoredError("Authentication not possible. No salt value stored"),
			};
		}

		const isModernV2 =
			Number(userDoc.passwordKdfVersion) >= MODERN_KDF.version &&
			Number(userDoc.passwordIterations) >= 100000;
		const iterations = isModernV2
			? Number(userDoc.passwordIterations)
			: LEGACY_KDF.iterations;
		const keylen = isModernV2
			? Number(userDoc.passwordKeylen) || MODERN_KDF.keylen
			: LEGACY_KDF.keylen;
		const digest = isModernV2
			? userDoc.passwordDigest || MODERN_KDF.digest
			: LEGACY_KDF.digest;

		const derivedBuf = await pbkdf2Async(password, storedSalt, iterations, keylen, digest);
		const storedBuf = Buffer.from(storedHash, "hex");
		const isMatch =
			derivedBuf.length === storedBuf.length &&
			crypto.timingSafeEqual(derivedBuf, storedBuf);

		if (isMatch) {
			if (!isModernV2) {
				// Transparently re-hash legacy 25k credential to 600k v2 upon verified login
				await userDoc.setPassword(password);
			}
			userDoc.set("attempts", 0);
			userDoc.set("last", Date.now());
			await userDoc.save();
			return { user: userDoc, error: undefined };
		}

		const nextAttempts = Number(userDoc.get("attempts") || 0) + 1;
		userDoc.set("attempts", nextAttempts);
		userDoc.set("last", Date.now());
		await userDoc.save();

		if (nextAttempts >= maxAttempts) {
			return {
				user: false,
				error: new plmErrors.TooManyAttemptsError("Account temporarily locked due to failed login attempts. Try again shortly."),
			};
		}
		return {
			user: false,
			error: new plmErrors.IncorrectPasswordError("Password or username is incorrect"),
		};
	});

	if (!cb) return promise;
	promise
		.then(({ user, error }) => cb(null, user, error))
		.catch((err) => cb(err));
};

const DUMMY_PBKDF2_SALT = "0000000000000000000000000000000000000000000000000000000000000000";

userSchema.statics.authenticate = function () {
	return (username, password, cb) => {
		const promise = Promise.resolve()
			.then(() => this.findByUsername(username, true))
			.then(async (user) => {
				if (user) {
					return user.authenticate(password);
				}
				// Constant-time work parity to prevent username-enumeration timing discrepancy
				await pbkdf2Async(
					typeof password === "string" ? password : "invalid",
					DUMMY_PBKDF2_SALT,
					MODERN_KDF.iterations,
					MODERN_KDF.keylen,
					MODERN_KDF.digest,
				);
				return {
					user: false,
					error: new plmErrors.IncorrectUsernameError("Password or username is incorrect"),
				};
			});

		if (!cb) return promise;
		promise
			.then(({ user, error }) => cb(null, user, error))
			.catch((err) => cb(err));
	};
};

userSchema.statics.KDF_CONSTANTS = {
	LEGACY_KDF,
	MODERN_KDF,
};

module.exports = mongoose.model("User", userSchema);

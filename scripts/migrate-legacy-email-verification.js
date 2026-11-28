/**
 * Safe, idempotent migration script for legacy User accounts created before Email OTP verification.
 * By default runs in read-only dry-run mode. Pass --apply to backfill accounts whose
 * `emailVerified` field was never recorded (`{ emailVerified: { $exists: false } }`).
 * Never modifies newly registered unverified accounts (`emailVerified: false`).
 */
const mongoose = require("mongoose");
const env = require("../config/env");
const User = require("../models/user");

async function migrateLegacyEmailVerification(userModel = User, { apply = false } = {}) {
	const legacyFilter = {
		$or: [
			{ emailVerified: { $exists: false } },
			{ emailVerified: null },
		],
	};

	const [legacyCount, unverifiedCount, verifiedCount] = await Promise.all([
		userModel.countDocuments(legacyFilter),
		userModel.countDocuments({ emailVerified: false }),
		userModel.countDocuments({ emailVerified: true }),
	]);

	if (!apply) {
		return {
			mode: "dry-run",
			legacyAccountsPendingBackfill: legacyCount,
			explicitlyUnverifiedAccounts: unverifiedCount,
			alreadyVerifiedAccounts: verifiedCount,
			modifiedCount: 0,
		};
	}

	const result = await userModel.updateMany(legacyFilter, [
		{
			$set: {
				emailVerified: true,
				emailVerifiedAt: { $ifNull: ["$createdAt", "$$NOW"] },
			},
		},
	]);

	return {
		mode: "apply",
		legacyAccountsPendingBackfill: legacyCount,
		explicitlyUnverifiedAccounts: unverifiedCount,
		alreadyVerifiedAccounts: verifiedCount,
		modifiedCount: result.modifiedCount || 0,
	};
}

async function main() {
	const apply = process.argv.includes("--apply");
	await mongoose.connect(env.DB_URL, {
		serverSelectionTimeoutMS: 5000,
		...(env.MONGO_REQUIRE_TLS ? { tls: true } : {}),
	});

	try {
		const report = await migrateLegacyEmailVerification(User, { apply });
		console.log(JSON.stringify({ status: "OK", ...report }, null, 2));
	} finally {
		await mongoose.disconnect();
	}
}

if (require.main === module) {
	main().catch((err) => {
		console.error("[LEGACY EMAIL MIGRATION FAILED]:", err.message);
		process.exit(1);
	});
}

module.exports = { migrateLegacyEmailVerification };

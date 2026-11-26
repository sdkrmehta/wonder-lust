/**
 * Strictly privacy-preserving password migration readiness audit.
 * Queries aggregate schema-version counts only; never projects usernames, emails, hashes, or salts.
 */
const mongoose = require("mongoose");
const env = require("../config/env");
const User = require("../models/user");

async function auditPasswordMigrationStats(userModel = User) {
	const [stats] = await userModel.collection
		.aggregate([
			{
				$group: {
					_id: null,
					totalUsers: { $sum: 1 },
					v2ModernCount: {
						$sum: {
							$cond: [
								{
									$and: [
										{ $gte: [{ $ifNull: ["$passwordKdfVersion", 1] }, 2] },
										{ $gte: [{ $ifNull: ["$passwordIterations", 0] }, 600000] },
									],
								},
								1,
								0,
							],
						},
					},
					untaggedLegacyCount: {
						$sum: {
							$cond: [
								{
									$or: [
										{ $eq: [{ $ifNull: ["$passwordKdfVersion", null] }, null] },
										{ $eq: [{ $ifNull: ["$passwordIterations", null] }, null] },
									],
								},
								1,
								0,
							],
						},
					},
					v1TaggedLegacyCount: {
						$sum: {
							$cond: [
								{
									$and: [
										{ $eq: ["$passwordKdfVersion", 1] },
										{ $lt: [{ $ifNull: ["$passwordIterations", 0] }, 600000] },
									],
								},
								1,
								0,
							],
						},
					},
					lockedAccountsCount: {
						$sum: {
							$cond: [{ $gte: [{ $ifNull: ["$attempts", 0] }, 10] }, 1, 0],
						},
					},
				},
			},
			{ $project: { _id: 0 } },
		])
		.toArray();

	return (
		stats || {
			totalUsers: 0,
			v2ModernCount: 0,
			untaggedLegacyCount: 0,
			v1TaggedLegacyCount: 0,
			lockedAccountsCount: 0,
		}
	);
}

async function main() {
	if (!process.argv.includes("--confirm-read-only")) {
		console.error("Pass --confirm-read-only to run aggregate KDF migration counts.");
		process.exit(2);
	}
	await mongoose.connect(env.DB_URL, {
		serverSelectionTimeoutMS: 5000,
		...(env.MONGO_REQUIRE_TLS ? { tls: true } : {}),
	});
	try {
		const counts = await auditPasswordMigrationStats(User);
		console.log(JSON.stringify({ status: "OK", counts }, null, 2));
	} finally {
		await mongoose.disconnect();
	}
}

if (require.main === module) {
	main().catch((err) => {
		console.error("[KDF AUDIT FAILED]:", err.message);
		process.exit(1);
	});
}

module.exports = { auditPasswordMigrationStats };

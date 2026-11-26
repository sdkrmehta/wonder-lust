/**
 * Strictly read-only MongoDB Atlas / Production Cluster Readiness Pre-Flight Check.
 * Verifies TLS URI & negotiated transport, replica set transaction capability,
 * DB user least-privilege roles (flags overly broad roles), and index presence.
 * Never reads or writes customer/application documents.
 */
const mongoose = require("mongoose");
const env = require("../config/env");

const PRIVILEGED_ROLES = new Set([
	"root",
	"atlasAdmin",
	"dbAdminAnyDatabase",
	"readWriteAnyDatabase",
	"userAdminAnyDatabase",
	"clusterAdmin",
	"__system",
]);

async function inspectMongoReadiness(uri, options = {}) {
	const requireTls = options.requireTls !== undefined ? options.requireTls : env.MONGO_REQUIRE_TLS;
	const isSrv = uri.startsWith("mongodb+srv://");
	const hasTlsParam = /[?&](tls|ssl)=true/i.test(uri);

	if (requireTls && !isSrv && !hasTlsParam) {
		throw new Error(
			"TLS enforcement failed: production URI must start with mongodb+srv:// or include ?tls=true.",
		);
	}

	const conn = await mongoose.createConnection(uri, {
		serverSelectionTimeoutMS: 5000,
		...(requireTls ? { tls: true } : {}),
	}).asPromise();

	try {
		const adminDb = conn.db.admin();
		const hello = await adminDb.command({ hello: 1 });
		const connStatus = await conn.db.command({ connectionStatus: 1 });

		const isReplicaSet = Boolean(hello.setName || hello.msg === "isdbgrid");
		const supportsTransactions =
			isReplicaSet &&
			typeof hello.logicalSessionTimeoutMinutes === "number" &&
			hello.logicalSessionTimeoutMinutes > 0;

		const roles = (connStatus.authInfo?.authenticatedUserRoles || []).map((r) => ({
			role: r.role,
			db: r.db,
		}));
		const excessiveRoles = roles.filter((r) => PRIVILEGED_ROLES.has(r.role));

		// Check collections & index counts (metadata only, zero document reads)
		const collections = await conn.db.listCollections().toArray();
		const existingCols = new Set(collections.map((c) => c.name));
		const indexSummary = {};
		for (const colName of ["listings", "bookings", "bookingnightlocks", "payments", "users", "rate_limit_hits"]) {
			if (existingCols.has(colName)) {
				const idxs = await conn.db.collection(colName).indexes();
				indexSummary[colName] = idxs.map((i) => i.name);
			} else {
				indexSummary[colName] = [];
			}
		}

		return {
			tlsConfiguredInUri: isSrv || hasTlsParam,
			replicaSet: hello.setName || (hello.msg === "isdbgrid" ? "sharded" : "standalone"),
			supportsTransactions,
			rolesCount: roles.length,
			roles,
			leastPrivilegeOk: excessiveRoles.length === 0,
			excessiveRoles: excessiveRoles.map((r) => `${r.role}@${r.db}`),
			indexSummary,
			ipAllowlistNote:
				"Verify Atlas Project -> Network Access restricts IP allowlist to production egress IPs (never 0.0.0.0/0).",
		};
	} finally {
		await conn.close();
	}
}

async function main() {
	const args = process.argv.slice(2);
	const confirmed = args.includes("--confirm-read-only");
	if (!confirmed) {
		console.error(
			"Refusing to connect without explicit --confirm-read-only flag. Inspecting metadata only does not write data.",
		);
		process.exit(2);
	}
	const targetUri = env.DB_URL;
	const requireTls = !args.includes("--allow-non-tls");
	const report = await inspectMongoReadiness(targetUri, { requireTls });
	console.log(JSON.stringify({ status: "OK", ...report }, null, 2));
}

if (require.main === module) {
	main().catch((err) => {
		console.error("[ATLAS PREFLIGHT FAILED]:", err.message);
		process.exit(1);
	});
}

module.exports = { inspectMongoReadiness, PRIVILEGED_ROLES };

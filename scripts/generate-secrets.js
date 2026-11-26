/**
 * Generates high-entropy production secret values locally without writing to .env.
 * Usage: node scripts/generate-secrets.js
 */
const crypto = require("crypto");

function genHex(bytes = 32) {
	return crypto.randomBytes(bytes).toString("hex");
}

function main() {
	console.log("# Copy these freshly generated secrets into your secrets manager or host env:");
	console.log(`SESSION_SECRET=${genHex(32)}`);
	console.log(`PAYMENT_WEBHOOK_SECRET=${genHex(32)}`);
	console.log(`HEALTH_CHECK_TOKEN=${genHex(24)}`);
	console.log(`REDIS_PASSWORD=${genHex(24)}`);
	console.log(`MONGO_INITDB_ROOT_PASSWORD=${genHex(24)}`);
}

if (require.main === module) {
	main();
}

module.exports = { genHex };

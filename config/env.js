const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const env = {
	NODE_ENV: process.env.NODE_ENV || "development",
	PORT: parseInt(process.env.PORT, 10) || 8080,
	DB_URL:
		process.env.ATLASDB_URL ||
		process.env.MONGO_URL ||
		"mongodb://localhost:27017/wonderlust",
	SESSION_SECRET:
		process.env.SECRET ||
		process.env.SESSION_SECRET ||
		"wonderlustsupersecretcode",
	isProduction: process.env.NODE_ENV === "production",
	isDevelopment:
		!process.env.NODE_ENV || process.env.NODE_ENV === "development",
	isTest: process.env.NODE_ENV === "test",

	// Cloudinary (optional / pluggable)
	cloudinary: {
		cloudName: process.env.CLOUD_NAME || "",
		apiKey: process.env.CLOUD_API || process.env.CLOUD_API_KEY || "",
		apiSecret: process.env.CLOUD_API_SECRET || "",
	},
};

// Basic startup validation
if (!env.DB_URL) {
	console.error("[CONFIG ERROR] MongoDB connection URL is missing!");
}

module.exports = env;

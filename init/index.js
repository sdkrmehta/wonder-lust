const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const initData = require("./data.js");
const Listing = require("../models/listing.js");
const User = require("../models/user.js");
const { geocodeLocation } = require("../utils/geocoder.js");

const MONGO_URL = process.env.ATLASDB_URL || process.env.DB_URL || process.env.MONGO_URL || "mongodb://localhost:27017/wonderlust";

async function main() {
	await mongoose.connect(MONGO_URL);
	console.log("Connected to MongoDB for database initialization.");

	const count = await Listing.countDocuments();
	if (count > 0 && !process.argv.includes("--force")) {
		console.log(
			`Database already contains ${count} listings. Aborting seed to prevent accidental data loss.\nPass --force if you intentionally wish to re-seed.`,
		);
		await mongoose.disconnect();
		process.exit(0);
	}

	// Find an existing user or fallback
	let defaultUser = await User.findOne({});
	if (!defaultUser) {
		console.log("Creating default host user for seeded listings...");
		defaultUser = new User({
			email: "host@wonderlust.local",
			username: "wonderlust_host",
		});
		await User.register(defaultUser, "Password123!");
	}

	await Listing.deleteMany({});
	const formattedData = initData.data.map((obj) => ({
		...obj,
		owner: defaultUser._id,
		category: obj.category || "General",
		geometry: {
			type: "Point",
			coordinates: geocodeLocation(obj.location, obj.country),
		},
	}));

	await Listing.insertMany(formattedData);
	console.log(`Successfully initialized database with ${formattedData.length} listings.`);

	await mongoose.disconnect();
	console.log("Database disconnected cleanly.");
}

main().catch((err) => {
	console.error("Initialization error:", err);
	process.exit(1);
});

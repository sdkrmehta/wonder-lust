const mongoose = require("mongoose");
const env = require("../config/env");
const Listing = require("../models/listing");
const { geocodeLocation } = require("../utils/geocoder");

async function fixGeometries() {
	const isStandalone = require.main === module;
	try {
		if (mongoose.connection.readyState !== 1) {
			await mongoose.connect(env.DB_URL, { serverSelectionTimeoutMS: 4000 });
			console.log("[MIGRATION] Connected to MongoDB.");
		}

		const listings = await Listing.find({ status: { $ne: "archived" } });
		console.log(`[MIGRATION] Inspecting ${listings.length} listings...`);

		let updatedCount = 0;
		for (const listing of listings) {
			const isDelhi = (listing.location || "").toLowerCase().includes("delhi") || (listing.country || "").toLowerCase().includes("delhi");
			const isPlaceholder = listing.geometry && listing.geometry.coordinates &&
				Math.abs(Number(listing.geometry.coordinates[0]) - 77.209) < 0.005 &&
				Math.abs(Number(listing.geometry.coordinates[1]) - 28.6139) < 0.005 &&
				!isDelhi;

			if (isPlaceholder || !listing.geometry || !listing.geometry.coordinates || listing.geometry.coordinates.length < 2) {
				const trueCoords = geocodeLocation(listing.location, listing.country);
				listing.geometry = {
					type: "Point",
					coordinates: trueCoords,
				};
				await listing.save();
				console.log(`[FIXED] "${listing.title}" (${listing.location}, ${listing.country}) -> [${trueCoords[0]}, ${trueCoords[1]}]`);
				updatedCount++;
			}
		}

		console.log(`[MIGRATION COMPLETED] Successfully updated ${updatedCount} listings with real geocoded coordinates.`);
		
		// Only disconnect if running as a standalone CLI script, never during server lifecycle
		if (isStandalone) {
			await mongoose.disconnect();
		}
	} catch (err) {
		console.warn("[MIGRATION NOTICE] MongoDB migration skipped or failed:", err.message);
	}
}

if (require.main === module) {
	fixGeometries().then(() => process.exit(0));
}

module.exports = fixGeometries;

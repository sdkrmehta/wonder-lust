/**
 * Non-destructive data migration script.
 * Enriches existing listing documents with appropriate categories, property types,
 * room specs, amenities, GeoJSON coordinates, images gallery array, status, and views,
 * while strictly preserving document IDs, titles, prices, images, and user ownership.
 */
const mongoose = require("mongoose");
const env = require("../config/env");
const Listing = require("../models/listing");
const { geocodeLocation } = require("../utils/geocoder");

async function enrichListings() {
	await mongoose.connect(env.DB_URL);
	console.log("Connected to MongoDB for listing enrichment...");

	const listings = await Listing.find({});
	console.log(`Found ${listings.length} existing listings to evaluate.`);

	let updatedCount = 0;

	for (const listing of listings) {
		let modified = false;
		const lowerTitle = (listing.title || "").toLowerCase();

		// Category classification
		if (!listing.category || listing.category === "General") {
			if (lowerTitle.includes("castle")) {
				listing.category = "Castles";
			} else if (
				lowerTitle.includes("mountain") ||
				lowerTitle.includes("ski") ||
				lowerTitle.includes("chalet")
			) {
				listing.category = "Mountains";
			} else if (
				lowerTitle.includes("downtown") ||
				lowerTitle.includes("city") ||
				lowerTitle.includes("tokyo") ||
				lowerTitle.includes("amsterdam")
			) {
				listing.category = "Iconic Cities";
			} else if (
				lowerTitle.includes("pool") ||
				lowerTitle.includes("maldives") ||
				lowerTitle.includes("greece")
			) {
				listing.category = "Amazing Pools";
			} else if (
				lowerTitle.includes("treehouse") ||
				lowerTitle.includes("safari") ||
				lowerTitle.includes("cabin")
			) {
				listing.category = "Camping";
			} else if (lowerTitle.includes("farm")) {
				listing.category = "Farms";
			} else if (
				lowerTitle.includes("cottage") ||
				lowerTitle.includes("retreat")
			) {
				listing.category = "Rooms";
			} else {
				listing.category = "Trending";
			}
			modified = true;
		}

		// Property type classification
		if (!listing.propertyType) {
			if (lowerTitle.includes("villa")) {
				listing.propertyType = "Villa";
			} else if (
				lowerTitle.includes("apartment") ||
				lowerTitle.includes("loft") ||
				lowerTitle.includes("penthouse")
			) {
				listing.propertyType = "Apartment";
			} else if (
				lowerTitle.includes("cabin") ||
				lowerTitle.includes("chalet")
			) {
				listing.propertyType = "Cabin";
			} else if (
				lowerTitle.includes("cottage") ||
				lowerTitle.includes("bungalow")
			) {
				listing.propertyType = "Cottage";
			} else if (
				lowerTitle.includes("beachfront") ||
				lowerTitle.includes("beach house")
			) {
				listing.propertyType = "Beachfront";
			} else {
				listing.propertyType = "House";
			}
			modified = true;
		}

		// Rooms, Beds, & Guests
		if (!listing.bedrooms) {
			listing.bedrooms =
				lowerTitle.includes("villa") || lowerTitle.includes("castle") ? 4 : 2;
			modified = true;
		}
		if (!listing.bathrooms) {
			listing.bathrooms = lowerTitle.includes("castle") ? 3 : 1;
			modified = true;
		}
		if (!listing.guests) {
			listing.guests = (listing.bedrooms || 2) * 2;
			modified = true;
		}

		// Amenities
		if (!listing.amenities || listing.amenities.length === 0) {
			const amList = ["Wifi", "Kitchen"];
			if (
				lowerTitle.includes("villa") ||
				lowerTitle.includes("luxury") ||
				lowerTitle.includes("pool")
			) {
				amList.push("Pool", "Air Conditioning", "Hot Tub");
			}
			if (
				lowerTitle.includes("cabin") ||
				lowerTitle.includes("cottage") ||
				lowerTitle.includes("retreat")
			) {
				amList.push("Free Parking", "Dedicated Workspace");
			} else {
				amList.push("TV", "Free Parking");
			}
			listing.amenities = amList;
			modified = true;
		}

		// GeoJSON Geometry
		if (
			!listing.geometry ||
			!listing.geometry.coordinates ||
			listing.geometry.coordinates.length < 2
		) {
			listing.geometry = {
				type: "Point",
				coordinates: geocodeLocation(listing.location, listing.country),
			};
			modified = true;
		}

		// Multi-image gallery initialization
		if (!listing.images || listing.images.length === 0) {
			if (listing.image && listing.image.url) {
				listing.images = [
					{
						url: listing.image.url,
						filename: listing.image.filename || "default",
						isPrimary: true,
					},
				];
				modified = true;
			}
		}

		// Status
		if (!listing.status) {
			listing.status = "published";
			modified = true;
		}

		// Views count
		if (listing.views === undefined || listing.views === null || listing.views === 0) {
			listing.views = Math.floor(Math.random() * 85) + 15;
			modified = true;
		}

		if (modified) {
			await listing.save();
			updatedCount++;
		}
	}

	console.log(
		`Enrichment complete: ${updatedCount} listings updated with discovery & media attributes.`,
	);
	await mongoose.disconnect();
}

enrichListings().catch((err) => {
	console.error("Enrichment error:", err);
	process.exit(1);
});

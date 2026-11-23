/**
 * Wanderlust Production ETL Ingestion Pipeline
 * Parses Inside Airbnb Seattle dataset (listings.csv & reviews.csv),
 * cleanses and transforms attributes, clears existing sample hotels,
 * and loads 3,800+ real-world properties into MongoDB.
 */
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const env = require("../config/env");
const Listing = require("../models/listing");
const Review = require("../models/review");
const Booking = require("../models/booking");
const User = require("../models/user");

// Curated high-resolution travel photography pools by property type
const PHOTO_POOLS = {
	Apartment: [
		"https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1200&q=80",
		"https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=80",
		"https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=80",
		"https://images.unsplash.com/photo-1493809842364-78817add7ffb?auto=format&fit=crop&w=1200&q=80",
		"https://images.unsplash.com/photo-1512918728675-ed5a9ecdebfd?auto=format&fit=crop&w=1200&q=80",
	],
	House: [
		"https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&w=1200&q=80",
		"https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=1200&q=80",
		"https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80",
		"https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80",
		"https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=1200&q=80",
	],
	Cabin: [
		"https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?auto=format&fit=crop&w=1200&q=80",
		"https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?auto=format&fit=crop&w=1200&q=80",
		"https://images.unsplash.com/photo-1518780664697-55e3ad937233?auto=format&fit=crop&w=1200&q=80",
		"https://images.unsplash.com/photo-1510798831971-661eb04b3739?auto=format&fit=crop&w=1200&q=80",
		"https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1200&q=80",
	],
	Villa: [
		"https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=1200&q=80",
		"https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=80",
		"https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1200&q=80",
		"https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=1200&q=80",
		"https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80",
	],
	Cottage: [
		"https://images.unsplash.com/photo-1552733407-5d5c46c3bb3b?auto=format&fit=crop&w=1200&q=80",
		"https://images.unsplash.com/photo-1570129477492-45c003edd2be?auto=format&fit=crop&w=1200&q=80",
		"https://images.unsplash.com/photo-1583608205776-bfd35f0d9f83?auto=format&fit=crop&w=1200&q=80",
		"https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=1200&q=80",
		"https://images.unsplash.com/photo-1598228723793-52759bba239c?auto=format&fit=crop&w=1200&q=80",
	],
	Boats: [
		"https://images.unsplash.com/photo-1569263979104-865ab7cd8d17?auto=format&fit=crop&w=1200&q=80",
		"https://images.unsplash.com/photo-1544735716-392fe2489ffa?auto=format&fit=crop&w=1200&q=80",
		"https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1200&q=80",
		"https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80",
		"https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?auto=format&fit=crop&w=1200&q=80",
	],
};

function parseCSV(content, maxRows = Infinity) {
	const rows = [];
	let currentRow = [];
	let currentField = "";
	let insideQuotes = false;

	for (let i = 0; i < content.length; i++) {
		const char = content[i];
		const nextChar = content[i + 1];

		if (char === '"') {
			if (insideQuotes && nextChar === '"') {
				currentField += '"';
				i++; // Skip escaped quote
			} else {
				insideQuotes = !insideQuotes;
			}
		} else if (char === "," && !insideQuotes) {
			currentRow.push(currentField);
			currentField = "";
		} else if ((char === "\r" || char === "\n") && !insideQuotes) {
			if (char === "\r" && nextChar === "\n") {
				i++;
			}
			currentRow.push(currentField);
			currentField = "";
			if (currentRow.length > 1 || (currentRow.length === 1 && currentRow[0] !== "")) {
				rows.push(currentRow);
				if (rows.length >= maxRows) break;
			}
			currentRow = [];
		} else {
			currentField += char;
		}
	}

	if (currentRow.length > 0 || currentField !== "") {
		currentRow.push(currentField);
		rows.push(currentRow);
	}

	return rows;
}

function parseAmenities(raw) {
	if (!raw) return ["Wifi", "Air Conditioning", "Free Parking"];
	const cleaned = raw.replace(/^\{/, "").replace(/\}$/, "");
	const parts = cleaned.split(",").map((s) => s.replace(/^"/, "").replace(/"$/, "").trim());

	const mapped = new Set();
	for (const p of parts) {
		const lower = p.toLowerCase();
		if (lower.includes("wireless") || lower.includes("internet") || lower.includes("wifi")) {
			mapped.add("Wifi");
		} else if (lower.includes("air condition")) {
			mapped.add("Air Conditioning");
		} else if (lower.includes("parking")) {
			mapped.add("Free Parking");
		} else if (lower.includes("pool")) {
			mapped.add("Pool");
		} else if (lower.includes("kitchen")) {
			mapped.add("Kitchen");
		} else if (lower.includes("tv") || lower.includes("cable")) {
			mapped.add("TV");
		} else if (lower.includes("hot tub")) {
			mapped.add("Hot Tub");
		} else if (lower.includes("workspace") || lower.includes("laptop")) {
			mapped.add("Dedicated Workspace");
		}
	}

	if (mapped.size === 0) {
		mapped.add("Wifi");
		mapped.add("Kitchen");
	}
	return Array.from(mapped);
}

function mapPropertyType(raw) {
	if (!raw) return "Apartment";
	const lower = raw.toLowerCase();
	if (lower.includes("house") || lower.includes("townhouse")) return "House";
	if (lower.includes("apt") || lower.includes("apartment") || lower.includes("condo") || lower.includes("loft")) return "Apartment";
	if (lower.includes("cabin") || lower.includes("chalet")) return "Cabin";
	if (lower.includes("cottage") || lower.includes("bungalow")) return "Cottage";
	if (lower.includes("villa")) return "Villa";
	if (lower.includes("boat") || lower.includes("yacht")) return "Boats";
	if (lower.includes("bed & breakfast") || lower.includes("hotel")) return "Hotel";
	return "Apartment";
}

function mapCategory(title, desc, propType, amenities, rawRating) {
	const t = (title + " " + desc).toLowerCase();
	if (propType === "Boats" || t.includes("boat") || t.includes("houseboat") || t.includes("yacht")) {
		return "Boats";
	}
	if (amenities.includes("Pool") || t.includes("pool")) {
		return "Amazing Pools";
	}
	if (propType === "Cabin" || t.includes("mountain") || t.includes("alpine") || t.includes("chalet") || t.includes("peak") || t.includes("ridge")) {
		return "Mountains";
	}
	if (t.includes("camp") || t.includes("tent") || t.includes("treehouse") || t.includes("nature")) {
		return "Camping";
	}
	if (t.includes("farm") || t.includes("barn") || t.includes("ranch")) {
		return "Farms";
	}
	if (t.includes("castle") || t.includes("historic") || t.includes("heritage") || t.includes("manor")) {
		return "Castles";
	}
	if (t.includes("private room") || t.includes("studio") || t.includes("suite") || propType === "Hotel") {
		return "Rooms";
	}
	if (rawRating >= 96) {
		return "Trending";
	}
	return "Iconic Cities";
}

async function runETL() {
	console.log("\n=======================================================");
	console.log("   WANDERLUST PRODUCTION DATASET ETL INGESTION");
	console.log("=======================================================\n");

	const startTime = Date.now();

	// Step 1: Connect to Database
	console.log("[1/5] Connecting to MongoDB...");
	await mongoose.connect(env.DB_URL);
	console.log("Connected successfully to:", env.DB_URL.replace(/\/\/.*@/, "//***@"));

	// Step 2: Remove All Existing Hotels / Seed Data
	console.log("\n[2/5] Purging all existing hotels, reviews, and bookings...");
	const deletedListings = await Listing.deleteMany({});
	const deletedReviews = await Review.deleteMany({});
	const deletedBookings = await Booking.deleteMany({});
	console.log(`- Removed ${deletedListings.deletedCount} existing listings.`);
	console.log(`- Removed ${deletedReviews.deletedCount} existing reviews.`);
	console.log(`- Removed ${deletedBookings.deletedCount} existing bookings.`);

	// Step 3: Ensure Default Host User & Reviewer Users
	console.log("\n[3/5] Setting up host and traveler accounts...");
	let hostUser = await User.findOne({ username: "wanderlust_host" });
	if (!hostUser) {
		hostUser = new User({
			email: "host@wanderlust.local",
			username: "wanderlust_host",
			role: "host",
		});
		await User.register(hostUser, "Password123!");
		console.log("Created default host account: wanderlust_host");
	}

	const reviewerUsernames = ["traveler_elena", "traveler_marcus", "traveler_chloe", "traveler_sam"];
	const reviewerUsers = [];
	for (const uname of reviewerUsernames) {
		let u = await User.findOne({ username: uname });
		if (!u) {
			u = new User({ email: `${uname}@wanderlust.local`, username: uname });
			await User.register(u, "Password123!");
		}
		reviewerUsers.push(u);
	}
	console.log(`Reviewer user pool ready (${reviewerUsers.length} accounts).`);

	// Step 4: Parse Reviews Dataset
	const dataDir = process.env.DATASET_DIR || path.join(__dirname, "..", "dataset");
	const reviewsPath = path.join(dataDir, "reviews.csv");
	const listingsPath = path.join(dataDir, "listings.csv");

	console.log("\n[4/5] Extracting & transforming reviews from reviews.csv...");
	const reviewsByListing = new Map();

	if (fs.existsSync(reviewsPath)) {
		const reviewsContent = fs.readFileSync(reviewsPath, "utf8");
		const reviewRows = parseCSV(reviewsContent);
		const revHeader = reviewRows[0];
		const revHMap = {};
		revHeader.forEach((h, i) => (revHMap[h] = i));

		console.log(`Parsed ${reviewRows.length - 1} raw review rows. Grouping top reviews per listing...`);

		for (let r = 1; r < reviewRows.length; r++) {
			const row = reviewRows[r];
			const listingId = (row[revHMap["listing_id"]] || "").trim();
			const comments = (row[revHMap["comments"]] || "").trim();
			const dateStr = (row[revHMap["date"]] || "").trim();
			const reviewerName = (row[revHMap["reviewer_name"]] || "").trim();

			if (!listingId || !comments || comments.length < 15) continue;

			if (!reviewsByListing.has(listingId)) {
				reviewsByListing.set(listingId, []);
			}
			const list = reviewsByListing.get(listingId);
			if (list.length < 3) { // Store top 3 rich reviews per listing
				list.push({ comments, dateStr, reviewerName });
			}
		}
		console.log(`Indexed reviews for ${reviewsByListing.size} distinct properties.`);
	}

	// Step 5: Extract & Transform Listings
	console.log("\n[5/5] Extracting & transforming listings from listings.csv...");
	const listingsContent = fs.readFileSync(listingsPath, "utf8");
	const listingRows = parseCSV(listingsContent);
	const listHeader = listingRows[0];
	const lHMap = {};
	listHeader.forEach((h, i) => (lHMap[h] = i));

	console.log(`Processing ${listingRows.length - 1} property listings...`);

	const BATCH_SIZE = 400;
	let totalImported = 0;
	let currentBatch = [];

	for (let i = 1; i < listingRows.length; i++) {
		const row = listingRows[i];
		const extId = (row[lHMap["id"]] || "").trim();
		const name = (row[lHMap["name"]] || "").trim();
		if (!name) continue;

		const summary = (row[lHMap["summary"]] || "").trim();
		const space = (row[lHMap["space"]] || "").trim();
		const description = summary || space || (row[lHMap["description"]] || "").trim() || "Experience luxury and comfort in this stunning handpicked sanctuary.";

		// Price cleanup & conversion from USD to INR
		const rawPriceStr = row[lHMap["price"]] || "";
		const rawPriceNum = Number(rawPriceStr.replace(/[^0-9.]/g, "")) || 95;
		// Standard exchange conversion: e.g. $85 USD -> ~₹6,800 INR
		const price = Math.round(rawPriceNum * 80);

		// Location & Coordinates
		const neighbourhood = (row[lHMap["neighbourhood_cleansed"]] || row[lHMap["neighbourhood"]] || "Seattle").trim();
		const city = (row[lHMap["city"]] || "Seattle").trim();
		const location = `${neighbourhood}, ${city}`;
		const country = (row[lHMap["country"]] || "United States").trim();

		const lat = parseFloat(row[lHMap["latitude"]]) || 47.6062;
		const lng = parseFloat(row[lHMap["longitude"]]) || -122.3321;

		// Specs
		const propType = mapPropertyType(row[lHMap["property_type"]]);
		const amenities = parseAmenities(row[lHMap["amenities"]]);
		const rawRating = parseFloat(row[lHMap["review_scores_rating"]]) || 95;
		const avgRating = Math.min(5, Math.max(1, Math.round((rawRating / 20) * 10) / 10));
		const category = mapCategory(name, description, propType, amenities, rawRating);

		const bedrooms = Math.max(1, parseInt(row[lHMap["bedrooms"]], 10) || 1);
		const bathrooms = Math.max(1, Math.round(parseFloat(row[lHMap["bathrooms"]]) || 1));
		const guests = Math.max(1, parseInt(row[lHMap["accommodates"]], 10) || 2);

		// Curated Image Gallery
		const pool = PHOTO_POOLS[propType] || PHOTO_POOLS.Apartment;
		const rawPic = (row[lHMap["picture_url"]] || "").trim();
		const primaryPic = (rawPic && !rawPic.includes("muscache.com")) ? rawPic : pool[i % pool.length];
		const galleryImages = [
			{ url: primaryPic, isPrimary: true, filename: "primary" },
			{ url: pool[(i + 1) % pool.length], isPrimary: false, filename: "thumb_1" },
			{ url: pool[(i + 2) % pool.length], isPrimary: false, filename: "thumb_2" },
			{ url: pool[(i + 3) % pool.length], isPrimary: false, filename: "thumb_3" },
			{ url: pool[(i + 4) % pool.length], isPrimary: false, filename: "thumb_4" },
		];

		// Transform associated reviews into Review documents
		const matchedReviews = reviewsByListing.get(extId) || [];
		const reviewIds = [];
		for (let revIdx = 0; revIdx < matchedReviews.length; revIdx++) {
			const rev = matchedReviews[revIdx];
			const assignedUser = reviewerUsers[revIdx % reviewerUsers.length];
			const revDoc = new Review({
				comment: rev.comments.slice(0, 500),
				rating: Math.min(5, Math.max(3, Math.round(avgRating))),
				cleanliness: Math.min(5, Math.max(3, Math.round(avgRating))),
				accuracy: Math.min(5, Math.max(3, Math.round(avgRating))),
				communication: 5,
				location: 5,
				checkIn: 5,
				value: Math.min(5, Math.max(3, Math.round(avgRating))),
				author: assignedUser._id,
				createdAt: rev.dateStr ? new Date(rev.dateStr) : new Date(),
				isVerifiedStay: true,
			});
			await revDoc.save();
			reviewIds.push(revDoc._id);
		}

		const listingDoc = {
			title: name,
			externalId: extId,
			description,
			image: {
				url: primaryPic,
				filename: "listing_cover",
			},
			images: galleryImages,
			price,
			location,
			country,
			geometry: {
				type: "Point",
				coordinates: [lng, lat],
			},
			propertyType: propType,
			category,
			status: "published",
			bedrooms,
			bathrooms,
			guests,
			amenities,
			avgRating,
			ratingBreakdown: {
				cleanliness: parseFloat(row[lHMap["review_scores_cleanliness"]]) / 2 || 4.8,
				accuracy: parseFloat(row[lHMap["review_scores_accuracy"]]) / 2 || 4.9,
				communication: parseFloat(row[lHMap["review_scores_communication"]]) / 2 || 4.9,
				location: parseFloat(row[lHMap["review_scores_location"]]) / 2 || 4.8,
				checkIn: parseFloat(row[lHMap["review_scores_checkin"]]) / 2 || 4.9,
				value: parseFloat(row[lHMap["review_scores_value"]]) / 2 || 4.7,
			},
			reviews: reviewIds,
			owner: hostUser._id,
			views: Math.floor(Math.random() * 250) + 25,
		};

		currentBatch.push(listingDoc);

		if (currentBatch.length >= BATCH_SIZE) {
			await Listing.insertMany(currentBatch, { ordered: false });
			totalImported += currentBatch.length;
			process.stdout.write(`  -> Ingested ${totalImported} listings...\r`);
			currentBatch = [];
		}
	}

	if (currentBatch.length > 0) {
		await Listing.insertMany(currentBatch, { ordered: false });
		totalImported += currentBatch.length;
	}

	const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
	console.log(`\n\n[SUCCESS] Ingestion completed in ${elapsedSec}s!`);
	console.log(`Total listings active in database: ${totalImported}`);

	await mongoose.disconnect();
	console.log("Database disconnected cleanly.");
}

runETL().catch((err) => {
	console.error("[FATAL ERROR during ETL]:", err);
	process.exit(1);
});

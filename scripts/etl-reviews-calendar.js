const fs = require("fs");
const path = require("path");
const readline = require("readline");
const mongoose = require("mongoose");
const env = require("../config/env");
const Listing = require("../models/listing");
const Review = require("../models/review");
const Booking = require("../models/booking");
const User = require("../models/user");

const DATASET_DIR = process.env.DATASET_DIR || path.join(__dirname, "../dataset");
const LISTINGS_CSV = path.join(DATASET_DIR, "listings.csv");
const REVIEWS_CSV = path.join(DATASET_DIR, "reviews.csv");
const CALENDAR_CSV = path.join(DATASET_DIR, "calendar.csv");

/**
 * Fast RFC4180 CSV parser for text fields with commas/newlines.
 */
function parseCSV(text) {
	const rows = [];
	let currentRow = [];
	let currentField = "";
	let insideQuotes = false;

	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		const nextChar = text[i + 1];

		if (char === '"') {
			if (insideQuotes && nextChar === '"') {
				currentField += '"';
				i++;
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

async function runETL() {
	console.log("=================================================");
	console.log("  Wonder-Lust: Ingesting Reviews & Calendar Data ");
	console.log("=================================================");

	console.log("\n[1/4] Connecting to MongoDB database...");
	await mongoose.connect(env.DB_URL);
	console.log("Connected to MongoDB successfully.");

	// -------------------------------------------------------------------------
	// Step 1: Ensure externalId is populated on all listings
	// -------------------------------------------------------------------------
	console.log("\n[2/4] Mapping & syncing externalId on Listing documents...");
	const dbListings = await Listing.find().select("_id title externalId price avgRating ratingBreakdown");
	console.log(`Found ${dbListings.length} listings in MongoDB.`);

	const listingsContent = fs.readFileSync(LISTINGS_CSV, "utf8");
	const listingRows = parseCSV(listingsContent);
	const listHeader = listingRows[0];
	const lHMap = {};
	listHeader.forEach((h, i) => (lHMap[h] = i));

	const listingByExtId = new Map();
	const listingUpdateOps = [];

	for (let i = 1; i < listingRows.length; i++) {
		const row = listingRows[i];
		const extId = (row[lHMap["id"]] || "").trim();
		const name = (row[lHMap["name"]] || "").trim();
		if (!extId || !name) continue;

		// The listings in DB correspond 1-to-1 by order and title
		const dbL = dbListings[i - 1];
		if (dbL) {
			if (!dbL.externalId || dbL.externalId !== extId) {
				listingUpdateOps.push({
					updateOne: {
						filter: { _id: dbL._id },
						update: { $set: { externalId: extId } },
					},
				});
				dbL.externalId = extId;
			}
			listingByExtId.set(extId, dbL);
		}
	}

	if (listingUpdateOps.length > 0) {
		console.log(`Updating ${listingUpdateOps.length} listings with externalId...`);
		await Listing.bulkWrite(listingUpdateOps);
	}
	console.log(`Mapped ${listingByExtId.size} listings to their dataset externalId.`);

	// -------------------------------------------------------------------------
	// Step 2: Ensure guest reviewer accounts
	// -------------------------------------------------------------------------
	console.log("\n[3/4] Preparing traveler reviewer accounts...");
	const sampleNames = [
		"Bianca", "Frank", "Kelly", "David", "Sarah", "Michael", "Elena", "Liam",
		"Sophia", "Lucas", "Maya", "Alexander", "Emma", "Daniel", "Olivia", "James",
		"Grace", "Ethan", "Chloe", "Noah", "Ava", "Benjamin", "Mia", "William",
	];
	const reviewerUsers = [];
	for (const name of sampleNames) {
		let u = await User.findOne({ username: name.toLowerCase() });
		if (!u) {
			u = new User({
				username: name.toLowerCase(),
				email: `${name.toLowerCase()}@seattletraveler.com`,
				role: "traveler",
				fullName: `${name} Traveler`,
			});
			await u.setPassword("Traveler@123");
			await u.save();
		}
		reviewerUsers.push(u);
	}
	console.log(`Active reviewer user pool ready (${reviewerUsers.length} accounts).`);

	// -------------------------------------------------------------------------
	// Step 3: Ingest Reviews (reviews.csv)
	// -------------------------------------------------------------------------
	console.log("\n[4/4 - Part A] Ingesting reviews from reviews.csv...");
	const reviewsContent = fs.readFileSync(REVIEWS_CSV, "utf8");
	const reviewRows = parseCSV(reviewsContent);
	const revHeader = reviewRows[0];
	const revHMap = {};
	revHeader.forEach((h, i) => (revHMap[h] = i));

	console.log(`Parsed ${reviewRows.length - 1} raw review rows. Grouping top reviews per listing...`);

	// Clear existing reviews to prevent duplication and ensure fresh, clean data
	await Review.deleteMany({});
	console.log("Cleared existing Review collection for clean ingestion.");

	const reviewsByExtId = new Map();
	const MAX_REVIEWS_PER_LISTING = 8; // Optimal balance of rich content and performance

	for (let r = 1; r < reviewRows.length; r++) {
		const row = reviewRows[r];
		const extId = (row[revHMap["listing_id"]] || "").trim();
		const comments = (row[revHMap["comments"]] || "").trim();
		const dateStr = (row[revHMap["date"]] || "").trim();
		const reviewerName = (row[revHMap["reviewer_name"]] || "").trim();

		if (!extId || !comments || comments.length < 15) continue;
		// Skip automated system cancellations
		if (comments.includes("automated posting") || comments.includes("reservation was canceled")) continue;

		if (!reviewsByExtId.has(extId)) {
			reviewsByExtId.set(extId, []);
		}
		const list = reviewsByExtId.get(extId);
		if (list.length < MAX_REVIEWS_PER_LISTING) {
			list.push({ comments, dateStr, reviewerName });
		}
	}

	console.log(`Grouped reviews for ${reviewsByExtId.size} distinct listings.`);

	// Batch insert reviews and collect their ObjectIds per listing
	let allReviewDocs = [];
	const listingReviewsMap = new Map();
	let reviewCounter = 0;

	for (const [extId, revList] of reviewsByExtId.entries()) {
		const targetListing = listingByExtId.get(extId);
		if (!targetListing) continue;

		const baseRating = targetListing.avgRating || 4.8;
		const reviewIds = [];

		for (let i = 0; i < revList.length; i++) {
			const rev = revList[i];
			const assignedUser = reviewerUsers[reviewCounter % reviewerUsers.length];
			reviewCounter++;

			// Determine rating: predominantly 5 and 4 with authentic slight variance
			const rScore = i === 0 ? 5 : (i % 3 === 0 ? 4 : 5);
			const revDocId = new mongoose.Types.ObjectId();
			reviewIds.push(revDocId);

			allReviewDocs.push({
				_id: revDocId,
				comment: rev.comments.slice(0, 800),
				rating: rScore,
				cleanliness: rScore,
				accuracy: rScore,
				communication: 5,
				location: 5,
				checkIn: 5,
				value: rScore,
				author: assignedUser._id,
				createdAt: rev.dateStr ? new Date(rev.dateStr) : new Date(),
				isVerifiedStay: true,
			});
		}

		listingReviewsMap.set(targetListing._id.toString(), reviewIds);
	}

	console.log(`Inserting ${allReviewDocs.length} curated Review documents into MongoDB...`);
	const REVIEW_BATCH = 2000;
	for (let i = 0; i < allReviewDocs.length; i += REVIEW_BATCH) {
		const batch = allReviewDocs.slice(i, i + REVIEW_BATCH);
		await Review.insertMany(batch, { ordered: false });
		process.stdout.write(`  Inserted ${Math.min(i + REVIEW_BATCH, allReviewDocs.length)} / ${allReviewDocs.length} reviews...\r`);
	}
	console.log(`\nSuccessfully inserted all ${allReviewDocs.length} reviews!`);

	// Update listings with the new reviews array
	console.log("Linking reviews back to listings in MongoDB...");
	const listingUpdateOps2 = [];
	for (const [listingIdStr, reviewIds] of listingReviewsMap.entries()) {
		listingUpdateOps2.push({
			updateOne: {
				filter: { _id: listingIdStr },
				update: { $set: { reviews: reviewIds } },
			},
		});
	}

	for (let i = 0; i < listingUpdateOps2.length; i += 500) {
		const batch = listingUpdateOps2.slice(i, i + 500);
		await Listing.bulkWrite(batch);
	}
	console.log(`Updated reviews array for ${listingUpdateOps2.length} listings.`);

	// -------------------------------------------------------------------------
	// Step 4: Ingest Calendar (calendar.csv) -> Active Booking Reservations
	// -------------------------------------------------------------------------
	console.log("\n[4/4 - Part B] Processing calendar.csv into active booking reservations...");
	// Clear any previous bookings
	await Booking.deleteMany({});
	console.log("Cleared existing Bookings for clean availability mapping.");

	// Anchor: today is Day 0. The dataset spans 365 days from 2016-01-04 to 2017-01-02.
	const anchorToday = new Date();
	anchorToday.setHours(0, 0, 0, 0);
	const baseDatasetDate = new Date("2016-01-04");

	const rl = readline.createInterface({
		input: fs.createReadStream(CALENDAR_CSV),
		crlfDelay: Infinity,
	});

	let currentListingId = null;
	let inBlockedBlock = false;
	let blockStart = null;
	let blockEnd = null;
	let calendarLineCount = 0;

	const allBookings = [];
	let bookingCounter = 0;

	function finalizeBlock(extId, startStr, endStr) {
		const l = listingByExtId.get(extId);
		if (!l) return;

		const startD = new Date(startStr);
		const endD = new Date(endStr);

		const offsetStartDays = Math.max(0, Math.round((startD - baseDatasetDate) / (24 * 60 * 60 * 1000)));
		const offsetEndDays = Math.max(offsetStartDays + 1, Math.round((endD - baseDatasetDate) / (24 * 60 * 60 * 1000)) + 1);

		const checkIn = new Date(anchorToday.getTime() + offsetStartDays * 24 * 60 * 60 * 1000);
		const checkOut = new Date(anchorToday.getTime() + offsetEndDays * 24 * 60 * 60 * 1000);

		const totalNights = Math.max(1, offsetEndDays - offsetStartDays);
		const nightlyPrice = l.price || 5000;
		const cleaningFee = 500;
		const taxAmount = Math.round((totalNights * nightlyPrice + cleaningFee) * 0.18);
		const totalPrice = totalNights * nightlyPrice + cleaningFee + taxAmount;

		const assignedGuest = reviewerUsers[bookingCounter % reviewerUsers.length];
		bookingCounter++;

		allBookings.push({
			listing: l._id,
			user: assignedGuest._id,
			checkIn,
			checkOut,
			guests: 2,
			totalNights,
			nightlyPrice,
			cleaningFee,
			taxAmount,
			totalPrice,
			status: "confirmed",
			paymentStatus: "paid",
		});
	}

	for await (const line of rl) {
		calendarLineCount++;
		if (calendarLineCount === 1) continue; // Skip header

		const parts = line.split(",");
		const extId = parts[0];
		const dateStr = parts[1];
		const avail = parts[2];

		if (extId !== currentListingId) {
			if (inBlockedBlock && currentListingId) {
				finalizeBlock(currentListingId, blockStart, blockEnd);
				inBlockedBlock = false;
				blockStart = null;
				blockEnd = null;
			}
			currentListingId = extId;
		}

		if (avail === "f") {
			if (!inBlockedBlock) {
				inBlockedBlock = true;
				blockStart = dateStr;
				blockEnd = dateStr;
			} else {
				blockEnd = dateStr;
			}
		} else {
			if (inBlockedBlock) {
				finalizeBlock(currentListingId, blockStart, blockEnd);
				inBlockedBlock = false;
				blockStart = null;
				blockEnd = null;
			}
		}

		if (calendarLineCount % 300000 === 0) {
			process.stdout.write(`  Processed ${calendarLineCount} / 1,393,570 calendar lines...\r`);
		}
	}

	if (inBlockedBlock && currentListingId) {
		finalizeBlock(currentListingId, blockStart, blockEnd);
	}

	console.log(`\nAggregated ${allBookings.length} realistic booking intervals from calendar.`);
	console.log(`Inserting ${allBookings.length} bookings into MongoDB...`);

	const BOOKING_BATCH = 2000;
	for (let i = 0; i < allBookings.length; i += BOOKING_BATCH) {
		const batch = allBookings.slice(i, i + BOOKING_BATCH);
		await Booking.insertMany(batch, { ordered: false });
		process.stdout.write(`  Inserted ${Math.min(i + BOOKING_BATCH, allBookings.length)} / ${allBookings.length} bookings...\r`);
	}
	console.log(`\nSuccessfully saved all ${allBookings.length} bookings in MongoDB!`);

	// -------------------------------------------------------------------------
	// Verification Summary
	// -------------------------------------------------------------------------
	const totalListings = await Listing.countDocuments();
	const totalReviews = await Review.countDocuments();
	const totalBookings = await Booking.countDocuments();

	console.log("\n=================================================");
	console.log("               ETL COMPLETE SUMMARY               ");
	console.log("=================================================");
	console.log(`- Total Properties in DB  : ${totalListings.toLocaleString()}`);
	console.log(`- Total Reviews Ingested   : ${totalReviews.toLocaleString()}`);
	console.log(`- Total Bookings/Calendar  : ${totalBookings.toLocaleString()}`);
	console.log("=================================================\n");

	await mongoose.disconnect();
}

runETL().catch((err) => {
	console.error("\nETL failed with error:", err);
	process.exit(1);
});

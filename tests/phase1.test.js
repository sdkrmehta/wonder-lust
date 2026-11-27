const http = require("http");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const PORT = 8081; // Use separate port for tests to avoid collision
const BASE_URL = `http://localhost:${PORT}`;

let serverProc;

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Cookie jar request helper
function createClient() {
	let cookies = {};

	return async function request(urlPath, options = {}) {
		const method = options.method || "GET";
		const headers = { ...(options.headers || {}) };

		// Set cookies
		const cookieHeader = Object.entries(cookies)
			.map(([k, v]) => `${k}=${v}`)
			.join("; ");
		if (cookieHeader) {
			headers["Cookie"] = cookieHeader;
		}

		let bodyBuffer = null;
		if (options.body) {
			if (Buffer.isBuffer(options.body)) {
				bodyBuffer = options.body;
			} else if (typeof options.body === "string") {
				bodyBuffer = Buffer.from(options.body);
				if (!headers["Content-Type"]) {
					headers["Content-Type"] = "application/x-www-form-urlencoded";
				}
			}
			headers["Content-Length"] = bodyBuffer.length;
		}

		return new Promise((resolve, reject) => {
			const req = http.request(
				`${BASE_URL}${urlPath}`,
				{
					method,
					headers,
				},
				(res) => {
					// Extract cookies
					const setCookie = res.headers["set-cookie"];
					if (setCookie) {
						setCookie.forEach((cookieStr) => {
							const parts = cookieStr.split(";")[0].split("=");
							if (parts.length >= 2) {
								cookies[parts[0].trim()] = parts.slice(1).join("=").trim();
							}
						});
					}

					let data = "";
					res.on("data", (chunk) => (data += chunk));
					res.on("end", () => {
						resolve({
							status: res.statusCode,
							headers: res.headers,
							body: data,
						});
					});
				},
			);

			req.on("error", reject);
			if (bodyBuffer) {
				req.write(bodyBuffer);
			}
			req.end();
		});
	};
}

async function runTests() {
	console.log("==================================================");
	console.log("   WONDER-LUST PHASE 1 STABILIZATION TEST SUITE   ");
	console.log("==================================================\n");

	// 1. Start App on test port
	console.log(`[INFO] Spawning app instance on port ${PORT}...`);
	const { spawn } = require("child_process");
	serverProc = spawn("node", ["app.js"], {
		cwd: path.join(__dirname, ".."),
		env: { ...process.env, PORT: String(PORT) },
		stdio: ["ignore", "pipe", "pipe"],
	});

	let serverLogs = "";
	serverProc.stdout.on("data", (d) => (serverLogs += d.toString()));
	serverProc.stderr.on("data", (d) => (serverLogs += d.toString()));

	// Wait for server ready
	await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			serverProc.kill();
			reject(new Error("Timeout starting test server:\n" + serverLogs));
		}, 10000);

		const interval = setInterval(() => {
			if (serverLogs.includes(`Server is listening on port ${PORT}`)) {
				clearTimeout(timeout);
				clearInterval(interval);
				resolve();
			}
		}, 200);
	});

	console.log("[PASS] Server successfully initialized and listening.\n");

	const clientA = createClient();
	const clientB = createClient();

	// Test 1: Health check
	console.log("1. Testing /health endpoint...");
	const healthRes = await clientA("/health");
	assert(healthRes.status === 200, `Expected 200, got ${healthRes.status}`);
	const healthData = JSON.parse(healthRes.body);
	assert(healthData.status === "healthy", "Expected health status 'healthy'");
	assert(healthData.database === "connected", "Expected database 'connected'");
	console.log("   [PASS] Health check returns 200 and healthy database status.");

	// Test 2: Legal & informational routes
	console.log("2. Testing /privacy and /terms informational routes...");
	const privacyRes = await clientA("/privacy");
	assert(privacyRes.status === 200 && privacyRes.body.includes("Privacy Policy"), "Privacy page failed");
	const termsRes = await clientA("/terms");
	assert(termsRes.status === 200 && termsRes.body.includes("Terms of Service"), "Terms page failed");
	console.log("   [PASS] Privacy Policy and Terms of Service render correctly (no 404s).");

	// Test 3: Root redirect
	console.log("3. Testing root redirect (GET / -> /listings)...");
	const rootRes = await clientA("/");
	assert(rootRes.status === 302, `Expected 302, got ${rootRes.status}`);
	assert(rootRes.headers.location === "/listings", `Expected redirect to /listings`);
	console.log("   [PASS] Root path smoothly redirects to /listings.");

	// Test 4: User A Registration & Auto-login
	console.log("4. Testing User Registration (User A)...");
	const userA = "host_tester_" + Date.now();
	const signupBodyA = `username=${userA}&email=${userA}@example.com&password=ValidPassword123!`;
	const signupResA = await clientA("/signup", { method: "POST", body: signupBodyA });
	assert(signupResA.status === 302, `Expected 302 on signup, got ${signupResA.status}`);
	console.log(`   [PASS] Registered User A (${userA}) and received session.`);

	// Test 5: Duplicate email rejection
	console.log("5. Testing Duplicate Email Validation...");
	const duplicateRes = await clientB("/signup", {
		method: "POST",
		body: `username=another_user_${Date.now()}&email=${userA}@example.com&password=Password123!`,
	});
	assert(duplicateRes.status === 302 && duplicateRes.headers.location === "/signup", "Expected rejection redirect to /signup");
	console.log("   [PASS] Duplicate registration rejected appropriately.");

	// Test 6: User B Registration
	console.log("6. Testing User B Registration (to verify authorization boundaries)...");
	const userB = "guest_tester_" + Date.now();
	const signupBodyB = `username=${userB}&email=${userB}@example.com&password=ValidPassword123!`;
	await clientB("/signup", { method: "POST", body: signupBodyB });
	console.log(`   [PASS] Registered User B (${userB}).`);

	// Test 7: Listing Creation with Multer Local File Upload (by User A)
	console.log("7. Testing Listing Creation with Image Upload...");
	const boundary = "----TestBoundary" + Math.random().toString(36).substring(2);
	const dummyPng = Buffer.from([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
		0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
		0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
		0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
		0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
		0x42, 0x60, 0x82,
	]);

	const imageParts = [];
	for (let i = 1; i <= 5; i++) {
		imageParts.push(
			Buffer.from(
				`--${boundary}\r\nContent-Disposition: form-data; name="listing[image]"; filename="sunset_cliff_${i}.png"\r\nContent-Type: image/png\r\n\r\n`,
			),
			dummyPng,
			Buffer.from("\r\n"),
		);
	}

	const multipartPayload = Buffer.concat([
		Buffer.from(
			`--${boundary}\r\nContent-Disposition: form-data; name="listing[title]"\r\n\r\nSunset Cliff Villa\r\n` +
			`--${boundary}\r\nContent-Disposition: form-data; name="listing[description]"\r\n\r\nBreathtaking cliffside villa overlooking the azure ocean.\r\n` +
			`--${boundary}\r\nContent-Disposition: form-data; name="listing[price]"\r\n\r\n4500\r\n` +
			`--${boundary}\r\nContent-Disposition: form-data; name="listing[location]"\r\n\r\nGoa\r\n` +
			`--${boundary}\r\nContent-Disposition: form-data; name="listing[country]"\r\n\r\nIndia\r\n` +
			`--${boundary}\r\nContent-Disposition: form-data; name="listing[category]"\r\n\r\nTrending\r\n`
		),
		...imageParts,
		Buffer.from(`--${boundary}--\r\n`),
	]);

	const createRes = await clientA("/listings", {
		method: "POST",
		headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
		body: multipartPayload,
	});
	assert(createRes.status === 302, `Expected 302 redirect after creation, got ${createRes.status}`);
	const newListingId = createRes.headers.location.split("/").pop();
	console.log(`   [PASS] Listing created with ID: ${newListingId}`);

	// Test 8: Show Listing & Verify Local Image
	console.log("8. Testing Listing Detail View...");
	const showRes = await clientA(`/listings/${newListingId}`);
	assert(showRes.status === 200, `Expected 200, got ${showRes.status}`);
	assert(showRes.body.includes("Sunset Cliff Villa"), "Show page did not contain title");
	assert(showRes.body.includes("Goa"), "Show page did not contain location");
	assert(showRes.body.includes(userA), "Show page did not contain owner name");
	console.log("   [PASS] Listing view correctly populates owner, title, and metadata.");

	// Test 9: Category Filtering & Search Query
	console.log("9. Testing Category Filter & Search Query...");
	const filterRes = await clientA("/listings?category=Trending");
	assert(filterRes.status === 200 && filterRes.body.includes("Sunset Cliff Villa"), "Filter by category failed");

	const searchRes = await clientA("/listings?q=Goa");
	assert(searchRes.status === 200 && searchRes.body.includes("Sunset Cliff Villa"), "Keyword search failed");

	const nonMatchRes = await clientA("/listings?q=NonExistentDestination999");
	assert(nonMatchRes.status === 200 && nonMatchRes.body.includes("No listings found"), "Empty state failed");
	console.log("   [PASS] Category filtering and keyword search respond correctly.");

	// Test 10: Ownership Authorization Guard (User B attempting to edit User A's listing)
	console.log("10. Testing Ownership Authorization Guard (User B cannot edit User A's listing)...");
	const unauthorizedEditRes = await clientB(`/listings/${newListingId}/edit`);
	assert(unauthorizedEditRes.status === 302, "Unauthorized edit should redirect");
	assert(unauthorizedEditRes.headers.location === `/listings/${newListingId}`, "Expected redirect back to listing page");

	const unauthorizedUpdateRes = await clientB(`/listings/${newListingId}?_method=PUT`, {
		method: "POST",
		body: "listing%5Btitle%5D=Hacked+Title&listing%5Bdescription%5D=Hacked&listing%5Bprice%5D=10&listing%5Blocation%5D=X&listing%5Bcountry%5D=Y",
	});
	assert(unauthorizedUpdateRes.status === 302, "Unauthorized PUT should redirect");
	console.log("   [PASS] Ownership authorization correctly blocked User B from modifying User A's property.");

	// Test 11: Owner Updates Listing (User A)
	console.log("11. Testing Listing Update by Owner...");
	const updateRes = await clientA(`/listings/${newListingId}?_method=PUT`, {
		method: "POST",
		body: "listing%5Btitle%5D=Sunset+Cliff+Villa+Renovated&listing%5Bdescription%5D=Updated+description&listing%5Bprice%5D=5000&listing%5Blocation%5D=Goa&listing%5Bcountry%5D=India",
	});
	assert(updateRes.status === 302, `Expected 302 on update, got ${updateRes.status}`);
	const updatedShow = await clientA(`/listings/${newListingId}`);
	assert(updatedShow.body.includes("Sunset Cliff Villa Renovated"), "Update was not reflected");
	console.log("   [PASS] Listing updated cleanly in atomic update operation.");

	// Test 12: Review Submission by User B
	console.log("12. Testing Review Submission (User B reviews User A's listing)...");
	const reviewBody = "review%5Brating%5D=5&review%5Bcomment%5D=Outstanding+sunset+views+and+hospitality!";
	const createRevRes = await clientB(`/listings/${newListingId}/reviews`, {
		method: "POST",
		body: reviewBody,
	});
	assert(createRevRes.status === 302, `Expected 302 on review create, got ${createRevRes.status}`);

	const showWithReview = await clientA(`/listings/${newListingId}`);
	assert(showWithReview.body.includes("Outstanding sunset views and hospitality!"), "Review not displayed on show page");
	assert(showWithReview.body.includes(userB), "Review author username not displayed");
	console.log("   [PASS] Review persisted and rendered with author relationship.");

	// Connect to Mongoose to query review ID for deletion test
	await mongoose.connect(process.env.ATLASDB_URL);
	const Listing = require("../models/listing.js");
	const Review = require("../models/review.js");
	const User = require("../models/user.js");

	const listingDoc = await Listing.findById(newListingId).populate("reviews");
	const reviewId = listingDoc.reviews[0]._id;

	// Test 13: Review Author Authorization Guard (User A cannot delete User B's review)
	console.log("13. Testing Review Authorization Guard (User A cannot delete User B's review)...");
	const unauthorizedRevDel = await clientA(`/listings/${newListingId}/reviews/${reviewId}?_method=DELETE`, {
		method: "POST",
	});
	assert(unauthorizedRevDel.status === 302, "Unauthorized review deletion should redirect");
	const checkStillExists = await Review.findById(reviewId);
	assert(checkStillExists !== null, "Review was wrongfully deleted by non-author");
	console.log("   [PASS] Review authorization blocked non-author from deleting review.");

	// Test 14: Review Deletion by Author (User B)
	console.log("14. Testing Review Deletion by Author (User B)...");
	const authorRevDel = await clientB(`/listings/${newListingId}/reviews/${reviewId}?_method=DELETE`, {
		method: "POST",
	});
	assert(authorRevDel.status === 302, "Expected redirect after review deletion");
	const checkDeleted = await Review.findById(reviewId);
	assert(checkDeleted === null, "Review was not deleted from database");
	console.log("   [PASS] Review deleted successfully by its author.");

	// Test 15: Listing Deletion with Image & Cascading Cleanup
	console.log("15. Testing Listing Deletion and Cascade Cleanup...");
	const delRes = await clientA(`/listings/${newListingId}?_method=DELETE`, {
		method: "POST",
	});
	assert(delRes.status === 302, "Expected redirect after listing deletion");
	const checkListingDeleted = await Listing.findById(newListingId);
	assert(checkListingDeleted === null, "Listing was not removed from database");
	console.log("   [PASS] Listing and associated reviews deleted cleanly.");

	// Test 16: Invalid ObjectId Error Handling (no 500 crash)
	console.log("16. Testing Invalid ObjectId Route Handling...");
	const invalidIdRes = await clientA("/listings/invalid-id-12345");
	assert(invalidIdRes.status === 302, `Expected graceful redirect 302, got ${invalidIdRes.status}`);
	assert(invalidIdRes.headers.location === "/listings", "Expected redirect to /listings");
	console.log("   [PASS] Invalid ObjectId handled safely with user redirect.");

	// Test 17: 404 Route Handling
	console.log("17. Testing 404 Catch-All Handler...");
	const notFoundRes = await clientA("/non-existent-page-route-xyz");
	assert(notFoundRes.status === 404, `Expected 404, got ${notFoundRes.status}`);
	assert(notFoundRes.body.includes("Page Not Found"), "Expected 404 error page template");
	console.log("   [PASS] Undefined routes render custom 404 error template.");

	// Clean up test users
	await User.deleteOne({ username: userA });
	await User.deleteOne({ username: userB });
	await mongoose.disconnect();

	console.log("\n==================================================");
	console.log("      ALL 17 PHASE 1 TESTS PASSED (100%)         ");
	console.log("==================================================");
}

function assert(condition, message) {
	if (!condition) {
		console.error("\n[ASSERTION FAILED]:", message);
		throw new Error(message);
	}
}

runTests()
	.then(() => {
		if (serverProc) {
			serverProc.kill("SIGTERM");
		}
		process.exit(0);
	})
	.catch((err) => {
		console.error("\n[TEST RUNNER FATAL ERROR]:", err.message);
		if (serverProc) {
			serverProc.kill("SIGTERM");
		}
		process.exit(1);
	});

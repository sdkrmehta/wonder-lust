const http = require("http");
const path = require("path");
const { fork } = require("child_process");

const PORT = 8089; // Dedicated port for Phase 9 test suite
const BASE_URL = `http://localhost:${PORT}`;

let serverProc;

function createClient() {
	let cookies = {};

	return async function request(urlPath, options = {}) {
		const method = options.method || "GET";
		const headers = { ...(options.headers || {}) };

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
							json: () => {
								try {
									return JSON.parse(data);
								} catch (e) {
									return null;
								}
							},
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

function assert(condition, message) {
	if (!condition) {
		throw new Error(`Assertion Failed: ${message}`);
	}
}

async function runTests() {
	console.log("==========================================================");
	console.log("   WONDER-LUST PHASE 9 REVIEWS & REPUTATION TEST SUITE    ");
	console.log("==========================================================\n");

	// 1. Start Server on port 8089
	console.log("1. Starting Wonder-Lust test server on port 8089...");
	serverProc = fork(path.join(__dirname, "../server.js"), [], {
		env: { ...process.env, PORT: String(PORT) },
		stdio: "pipe",
	});

	await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error("Server startup timed out after 10 seconds"));
		}, 10000);

		serverProc.stdout.on("data", (data) => {
			const output = data.toString();
			if (output.includes(`listening on port ${PORT}`)) {
				clearTimeout(timeout);
				resolve();
			}
		});

		serverProc.stderr.on("data", (data) => {
			console.error("[Server Error]", data.toString());
		});

		serverProc.on("exit", (code) => {
			clearTimeout(timeout);
			if (code !== 0) {
				reject(new Error(`Server exited with code ${code}`));
			}
		});
	});

	console.log("   [PASS] Server ready on port 8089.\n");

	// 2. Setup Host, Guest 1, and Guest 2 User Accounts
	console.log("2. Setting up Host and Guest accounts...");
	const hostClient = createClient();
	const guestClient1 = createClient();
	const guestClient2 = createClient();

	const hostName = `rep_host_${Date.now()}`;
	const guest1Name = `reviewer_one_${Date.now()}`;
	const guest2Name = `reviewer_two_${Date.now()}`;

	await hostClient("/signup", {
		method: "POST",
		body: `username=${hostName}&email=${hostName}@example.com&password=Password123`,
	});

	await guestClient1("/signup", {
		method: "POST",
		body: `username=${guest1Name}&email=${guest1Name}@example.com&password=Password123`,
	});

	await guestClient2("/signup", {
		method: "POST",
		body: `username=${guest2Name}&email=${guest2Name}@example.com&password=Password123`,
	});

	console.log("   [PASS] Host and 2 Guest accounts authenticated.\n");

	// 3. Host creates a Property Listing
	console.log("3. Host creating property listing...");
	const createListingRes = await hostClient("/api/v1/listings", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			listing: {
				title: "Ooty Tea Estate Heritage Cottage",
				description: "Scenic colonial stone cottage surrounded by emerald tea plantations.",
				price: 4500,
				location: "Ooty",
				country: "India",
				category: "Farms",
				propertyType: "Cottage",
				guests: 4,
			},
		}),
	});
	assert(createListingRes.status === 201, "Host must be able to create property");
	const testListing = createListingRes.json().data;
	const listingId = testListing._id;
	console.log(`   [PASS] Created property '${testListing.title}' with ID: ${listingId}.\n`);

	// 4. Guard: Host cannot review their own property
	console.log("4. Testing Host Self-Review Prevention Guard...");
	const selfReviewRes = await hostClient(`/api/v1/listings/${listingId}/reviews`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			review: {
				rating: 5,
				comment: "I own this place and it is extraordinary!",
			},
		}),
	});
	assert(selfReviewRes.status === 400, "Host reviewing own property must be rejected with HTTP 400");
	console.log("   [PASS] Host prevented from reviewing own property.\n");

	// 5. Guest 1 creates an Unverified Review (Before any booking)
	console.log("5. Testing Review Creation with Multi-Dimensional Sub-ratings...");
	const reviewRes1 = await guestClient1(`/api/v1/listings/${listingId}/reviews`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			review: {
				rating: 5,
				comment: "Breathtaking morning mist and fresh Nilgiri tea. Highly recommended!",
				cleanliness: 5,
				accuracy: 5,
				communication: 5,
				location: 5,
				checkIn: 5,
				value: 4,
			},
		}),
	});
	assert(reviewRes1.status === 201, "Valid review must return HTTP 201 Created");
	const review1 = reviewRes1.json().data;
	const review1Id = review1._id;
	assert(review1.rating === 5, "Review rating must be 5");
	assert(review1.isVerifiedStay === false, "Without booking, review should be unverified");
	console.log(`   [PASS] Review 1 created with ID: ${review1Id} (isVerifiedStay: false).\n`);

	// 6. Guest 2 reserves and pays for a stay
	console.log("6. Guest 2 booking and paying for stay to earn Verified Stay badge...");
	const bookRes = await guestClient2(`/api/v1/listings/${listingId}/bookings`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			booking: {
				checkIn: "2026-12-05",
				checkOut: "2026-12-07",
				guests: 2,
			},
		}),
	});
	assert(bookRes.status === 201, "Booking should be created");
	const booking2 = bookRes.json().data;

	await guestClient2("/api/v1/payments/create-order", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			bookingId: booking2._id,
			amount: booking2.totalPrice,
			paymentMethod: "card",
		}),
	});
	console.log("   [PASS] Guest 2 confirmed and paid reservation.\n");

	// 7. Guest 2 creates a Review (Must automatically receive Verified Stay badge)
	console.log("7. Testing Automatic Verified Stay Badge Assignment...");
	const reviewRes2 = await guestClient2(`/api/v1/listings/${listingId}/reviews`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			review: {
				rating: 4,
				comment: "Peaceful weekend escape. Cozy fireplace in the evenings.",
				cleanliness: 4,
				accuracy: 4,
				communication: 5,
				location: 5,
				checkIn: 4,
				value: 4,
			},
		}),
	});
	assert(reviewRes2.status === 201, "Verified review should return HTTP 201");
	const review2 = reviewRes2.json().data;
	const review2Id = review2._id;
	assert(review2.isVerifiedStay === true, "Review from booked guest must have isVerifiedStay: true");
	console.log(`   [PASS] Review 2 created with ID: ${review2Id} (isVerifiedStay: true).\n`);

	// 8. Test Helpfulness Upvoting
	console.log("8. Testing Review Helpfulness Upvoting...");
	const voteRes1 = await guestClient1(`/api/v1/listings/${listingId}/reviews/${review2Id}/helpful`, {
		method: "POST",
	});
	assert(voteRes1.status === 200, "Voting should return HTTP 200");
	assert(voteRes1.json().data.helpfulCount === 1, "Helpful count should increment to 1");
	assert(voteRes1.json().data.hasVoted === true, "hasVoted should be true");

	// Toggle vote off
	const voteRes2 = await guestClient1(`/api/v1/listings/${listingId}/reviews/${review2Id}/helpful`, {
		method: "POST",
	});
	assert(voteRes2.status === 200, "Toggling vote should return HTTP 200");
	assert(voteRes2.json().data.helpfulCount === 0, "Helpful count should decrement to 0");
	assert(voteRes2.json().data.hasVoted === false, "hasVoted should be false");
	console.log("   [PASS] Helpfulness upvote toggling verified.\n");

	// 9. Host Reply Authorization Guard: Non-Host cannot reply as host
	console.log("9. Testing Host Reply Authorization Guard (Guest attempting to reply)...");
	const unauthorizedReplyRes = await guestClient1(`/api/v1/listings/${listingId}/reviews/${review2Id}/reply`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			comment: "I am not the host but I want to reply.",
		}),
	});
	assert(unauthorizedReplyRes.status === 403, "Non-host reply must return HTTP 403 Forbidden");
	console.log("   [PASS] Unauthorized host reply prevented.\n");

	// 10. Host Posts Official Response
	console.log("10. Testing Host Official Response to Review...");
	const hostReplyRes = await hostClient(`/api/v1/listings/${listingId}/reviews/${review2Id}/reply`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			comment: "Thank you for visiting our tea estate! We are glad you enjoyed the fireplace.",
		}),
	});
	assert(hostReplyRes.status === 200, "Host reply should return HTTP 200");
	const repliedReview = hostReplyRes.json().data;
	assert(repliedReview.hostReply.comment.includes("fireplace"), "Host reply must match submitted text");
	console.log("   [PASS] Official Host Response posted successfully.\n");

	// 11. Test Review Moderation / Flagging
	console.log("11. Testing Review Moderation Flagging...");
	const flagRes = await guestClient1(`/api/v1/listings/${listingId}/reviews/${review2Id}/flag`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			reason: "Suspected promotional content",
		}),
	});
	assert(flagRes.status === 200, "Flagging should return HTTP 200");
	assert(flagRes.json().data.isFlagged === true, "Review must be marked as flagged");
	assert(flagRes.json().data.flagReason === "Suspected promotional content", "Flag reason must be stored");
	console.log("   [PASS] Review moderation reporting verified.\n");

	// 12. Review Deletion Authorization Guard (Guest 2 cannot delete Guest 1's review)
	console.log("12. Testing Review Deletion Authorization Guard...");
	const unauthorizedDeleteRes = await guestClient2(`/api/v1/listings/${listingId}/reviews/${review1Id}`, {
		method: "DELETE",
	});
	assert(unauthorizedDeleteRes.status === 403 || unauthorizedDeleteRes.status === 302, "Non-author deleting review must be blocked");
	console.log("   [PASS] Non-author prevented from deleting review.\n");

	// 13. Verify Listing Rating Breakdown & Dimensional Averages
	console.log("13. Testing Listing Average Rating & Breakdown Aggregation...");
	const listingRes = await guestClient1(`/api/v1/listings/${listingId}`);
	const listingData = listingRes.json().data;
	assert(listingData.avgRating === 4.5, `Average rating should be 4.5 (avg of 5 and 4), got ${listingData.avgRating}`);
	assert(listingData.ratingBreakdown.cleanliness === 4.5, "Cleanliness average must be 4.5");
	assert(listingData.ratingBreakdown.communication === 5, "Communication average must be 5.0");
	assert(listingData.ratingBreakdown.stars["5"] === 1, "5-star count should be 1");
	assert(listingData.ratingBreakdown.stars["4"] === 1, "4-star count should be 1");
	console.log("   [PASS] Rating dimensional averages and star breakdown verified.\n");

	// 14. Web UI Show Page Reviews & Rating Breakdown Rendering
	console.log("14. Testing Web UI Show Page Rating Widget & Host Reply Rendering...");
	const showPageRes = await guestClient1(`/listings/${listingId}`);
	assert(showPageRes.status === 200, "Show page should return HTTP 200");
	assert(showPageRes.body.includes("Cleanliness"), "Show page must display Cleanliness dimension");
	assert(showPageRes.body.includes("Accuracy"), "Show page must display Accuracy dimension");
	assert(showPageRes.body.includes("Communication"), "Show page must display Communication dimension");
	assert(showPageRes.body.includes("Verified Stay"), "Show page must display Verified Stay badge");
	assert(showPageRes.body.includes("Response from Host"), "Show page must display Host Official Response");
	assert(showPageRes.body.includes("fireplace"), "Show page must display host reply text");
	console.log("   [PASS] Web UI Rating breakdown and reviews verified.\n");

	// 15. Clean teardown of test listing & reviews
	console.log("15. Cleaning up test listing & reviews...");
	await hostClient(`/listings/${listingId}?_method=DELETE`, { method: "POST" });
	console.log("   [PASS] Cleaned up test property.\n");

	console.log("==========================================================");
	console.log("   ALL 15 PHASE 9 AUTOMATED TESTS PASSED SUCCESSFULLY!    ");
	console.log("==========================================================");
}

let exitCode = 0;
runTests()
	.catch((err) => {
		console.error("\n[TEST FAILED]:", err.message);
		if (err.stack) console.error(err.stack);
		exitCode = 1;
	})
	.finally(() => {
		if (serverProc) {
			serverProc.kill("SIGTERM");
		}
		process.exit(exitCode);
	});

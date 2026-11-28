const http = require("http");
const path = require("path");
const { fork } = require("child_process");
const {
	startMockResendServer,
	signupAndVerifyClient,
} = require("./helpers/testHarness");

const PORT = 8086; // Independent port for Phase 6 test suite
const BASE_URL = `http://localhost:${PORT}`;

let serverProc;
let mockResend;

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
	console.log("   WONDER-LUST PHASE 6 BOOKING & RESERVATION TEST SUITE   ");
	console.log("==========================================================\n");

	// 1. Start Server on port 8086
	console.log("1. Starting Wonder-Lust test server on port 8086...");
	mockResend = await startMockResendServer();
	serverProc = fork(path.join(__dirname, "../server.js"), [], {
		env: {
			...process.env,
			PORT: String(PORT),
			PAYMENT_PROVIDER: "sandbox",
			APP_BASE_URL: BASE_URL,
			RESEND_API_KEY: "re_test_mock_key",
			RESEND_FROM_EMAIL: "Wonder-Lust <no-reply@wonderlust.test>",
			RESEND_BASE_URL: mockResend.url,
			OTP_HASH_SECRET: "test-otp-hash-secret-phase6",
		},
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

	console.log("   [PASS] Server ready on port 8086.\n");

	// 2. Setup Host and Guest User Accounts
	console.log("2. Setting up Host and Guest accounts...");
	const hostClient = createClient();
	const guestClient1 = createClient();
	const guestClient2 = createClient();

	const hostName = `booking_host_${Date.now()}`;
	const guest1Name = `traveler_one_${Date.now()}`;
	const guest2Name = `traveler_two_${Date.now()}`;

	await signupAndVerifyClient(hostClient, mockResend, {
		username: hostName,
		email: `${hostName}@example.com`,
		password: "Password123",
	});

	await signupAndVerifyClient(guestClient1, mockResend, {
		username: guest1Name,
		email: `${guest1Name}@example.com`,
		password: "Password123",
	});

	await signupAndVerifyClient(guestClient2, mockResend, {
		username: guest2Name,
		email: `${guest2Name}@example.com`,
		password: "Password123",
	});
	console.log("   [PASS] Host and 2 Guest travelers authenticated.\n");

	// 3. Create a Property as Host
	console.log("3. Creating Test Property as Host...");
	const createListingRes = await hostClient("/api/v1/listings", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			listing: {
				title: "Goa Sunset Beachfront Villa",
				description: "Private luxury villa with direct beach access.",
				price: 5000,
				location: "Goa",
				country: "India",
				propertyType: "Villa",
				guests: 6,
			},
		}),
	});
	assert(createListingRes.status === 201, "Host must be able to create listing");
	const testListing = createListingRes.json().data;
	const listingId = testListing._id;
	console.log(`   [PASS] Created property '${testListing.title}' with ID: ${listingId}.\n`);

	// 4. Test Host Self-Booking Prevention
	console.log("4. Testing Host Self-Booking Guard...");
	const selfBookRes = await hostClient(`/api/v1/listings/${listingId}/bookings`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			booking: {
				checkIn: "2026-12-01",
				checkOut: "2026-12-05",
				guests: 2,
			},
		}),
	});
	assert(selfBookRes.status === 400, "Host booking own property should be rejected with HTTP 400");
	console.log("   [PASS] Host prevented from booking their own property.\n");

	// 5. Test Check-in / Check-out Validation
	console.log("5. Testing Invalid Dates Validation (Check-out before Check-in)...");
	const invalidDateRes = await guestClient1(`/api/v1/listings/${listingId}/bookings`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			booking: {
				checkIn: "2026-12-05",
				checkOut: "2026-12-01", // checkOut before checkIn
				guests: 2,
			},
		}),
	});
	assert(invalidDateRes.status === 400, "Invalid date sequence must be rejected with HTTP 400");
	console.log("   [PASS] Invalid date range rejected.\n");

	// 6. Test Successful Reservation by Guest 1
	console.log("6. Testing Successful Reservation Creation (Guest 1: Dec 10 - Dec 15 = 5 nights)...");
	const bookRes1 = await guestClient1(`/api/v1/listings/${listingId}/bookings`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			booking: {
				checkIn: "2026-12-10",
				checkOut: "2026-12-15",
				guests: 4,
			},
		}),
	});
	assert(bookRes1.status === 201, "Valid reservation should return HTTP 201 Created");
	const booking1 = bookRes1.json().data;
	assert(booking1.totalNights === 5, "Total nights must be 5");
	assert(booking1.nightlyPrice === 5000, "Nightly rate must be 5000");
	assert(booking1.cleaningFee === 500, "Cleaning fee must be 500");
	const expectedBase = 5 * 5000; // 25000
	const expectedTax = Math.round((expectedBase + 500) * 0.18); // 4590
	const expectedTotal = expectedBase + 500 + expectedTax; // 30090
	assert(booking1.totalPrice === expectedTotal, `Total price should be ₹${expectedTotal}, got ₹${booking1.totalPrice}`);
	assert(booking1.status === "confirmed", "Booking status should be confirmed");
	console.log(`   [PASS] Reservation confirmed with ID: ${booking1._id} for ₹${booking1.totalPrice}.\n`);

	// 7. Test Overlap Conflict Prevention (Guest 2 attempting Dec 12 - Dec 18)
	console.log("7. Testing Date Overlap Conflict Prevention (Guest 2 overlapping Dec 12 - Dec 18)...");
	const conflictRes = await guestClient2(`/api/v1/listings/${listingId}/bookings`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			booking: {
				checkIn: "2026-12-12",
				checkOut: "2026-12-18",
				guests: 2,
			},
		}),
	});
	assert(conflictRes.status === 400, "Conflicting date range must be rejected with HTTP 400");
	assert(
		conflictRes.json().message.includes("already booked"),
		"Error message should explain date conflict",
	);
	console.log("   [PASS] Double-booking prevented! Overlapping reservation was rejected.\n");

	// 8. Test Booked Dates API
	console.log("8. Testing Booked Dates Endpoint (GET /listings/:id/booked-dates)...");
	const bookedDatesRes = await guestClient2(`/api/v1/listings/${listingId}/booked-dates`);
	assert(bookedDatesRes.status === 200, "Booked dates endpoint should return 200");
	const datesArray = bookedDatesRes.json().data;
	assert(Array.isArray(datesArray) && datesArray.length >= 1, "Must return active booked date intervals");
	console.log(`   [PASS] Booked dates returned ${datesArray.length} reserved interval(s).\n`);

	// 9. Test User Trips Dashboard (GET /bookings) & Single Receipt (GET /bookings/:id)
	console.log("9. Testing Guest Bookings Dashboard & Receipt...");
	const tripsRes = await guestClient1("/bookings");
	assert(tripsRes.status === 200, "My Bookings page should return 200");
	assert(tripsRes.body.includes("Goa Sunset Beachfront Villa"), "Trips page must list property title");
	assert(tripsRes.body.includes("Confirmed"), "Trips page must show Confirmed badge");

	const receiptRes = await guestClient1(`/bookings/${booking1._id}`);
	assert(receiptRes.status === 200, "Receipt page should return 200");
	assert(receiptRes.body.includes("Reservation Confirmed!"), "Receipt must confirm reservation");
	assert(receiptRes.body.includes("Price Breakdown"), "Receipt must show price breakdown table");
	assert(receiptRes.body.includes(String(booking1._id)), "Receipt must display booking ID");
	console.log("   [PASS] Guest Trips dashboard and confirmation receipt verified.\n");

	// 10. Test Host Reservations Dashboard
	console.log("10. Testing Host Reservations Dashboard (GET /bookings/host)...");
	const hostDashRes = await hostClient("/bookings/host");
	assert(hostDashRes.status === 200, "Host reservations dashboard should return 200");
	assert(hostDashRes.body.includes("Goa Sunset Beachfront Villa"), "Host dashboard must list property");
	assert(hostDashRes.body.includes(guest1Name), "Host dashboard must display guest username");
	console.log("   [PASS] Host reservations dashboard verified.\n");

	// 11. Test Booking Cancellation Workflow
	console.log("11. Testing Booking Cancellation Workflow...");
	const cancelRes = await guestClient1(`/api/v1/bookings/${booking1._id}/cancel`, {
		method: "PATCH",
	});
	assert(cancelRes.status === 200, "Cancellation should return HTTP 200");
	const cancelledBooking = cancelRes.json().data;
	assert(cancelledBooking.status === "cancelled", "Booking status must update to cancelled");
	console.log("   [PASS] Reservation successfully cancelled.\n");

	// 12. Test Date Re-booking After Cancellation
	console.log("12. Testing Released Dates Availability (Guest 2 re-booking Dec 10 - Dec 15)...");
	const rebookRes = await guestClient2(`/api/v1/listings/${listingId}/bookings`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			booking: {
				checkIn: "2026-12-10",
				checkOut: "2026-12-15",
				guests: 2,
			},
		}),
	});
	assert(rebookRes.status === 201, "Cancelled dates must become immediately available for new reservations");
	const booking2 = rebookRes.json().data;
	assert(booking2.status === "confirmed", "New reservation must be confirmed");
	console.log("   [PASS] Dates released and successfully reserved by Guest 2.\n");

	// 13. Test Show Page Interactive Booking Widget
	console.log("13. Testing Web UI Show Page Booking Widget...");
	const showPageRes = await guestClient2(`/listings/${listingId}`);
	assert(showPageRes.status === 200, "Listing show page should return 200");
	assert(showPageRes.body.includes("id=\"bookingReservationForm\""), "Show page must include booking form");
	assert(showPageRes.body.includes("id=\"checkInInput\""), "Show page must include check-in input");
	assert(showPageRes.body.includes("id=\"checkOutInput\""), "Show page must include check-out input");
	assert(showPageRes.body.includes("id=\"priceCalculationContainer\""), "Show page must include price calculator");
	console.log("   [PASS] Property show page interactive booking widget verified.\n");

	// 14. Cleanup Test Listings & Bookings
	console.log("14. Cleaning up test listing & reservations...");
	await hostClient(`/listings/${listingId}?_method=DELETE`, { method: "POST" });
	console.log("   [PASS] Cleaned up test property.\n");

	console.log("==========================================================");
	console.log("   ALL 14 PHASE 6 AUTOMATED TESTS PASSED SUCCESSFULLY!    ");
	console.log("==========================================================");
}

let exitCode = 0;
runTests()
	.catch((err) => {
		console.error("\n[TEST FAILED]:", err.message);
		if (err.stack) console.error(err.stack);
		exitCode = 1;
	})
	.finally(async () => {
		if (serverProc) {
			serverProc.kill("SIGTERM");
		}
		if (mockResend) {
			await mockResend.close().catch(() => {});
		}
		process.exit(exitCode);
	});

const http = require("http");
const path = require("path");
const { fork } = require("child_process");

const PORT = 8088; // Dedicated port for Phase 8 test suite
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
	console.log("   WANDER-LUST PHASE 8 PROFILES & HOST DASHBOARD TESTS    ");
	console.log("==========================================================\n");

	// 1. Start Server on port 8088
	console.log("1. Starting Wander-Lust test server on port 8088...");
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

	console.log("   [PASS] Server ready on port 8088.\n");

	// 2. Setup Host and Traveler User Accounts
	console.log("2. Setting up Host and Traveler accounts...");
	const hostClient = createClient();
	const guestClient = createClient();
	const anonClient = createClient();

	const hostName = `superhost_${Date.now()}`;
	const guestName = `wanderer_${Date.now()}`;

	await hostClient("/signup", {
		method: "POST",
		body: `username=${hostName}&email=${hostName}@example.com&password=Password123`,
	});

	await guestClient("/signup", {
		method: "POST",
		body: `username=${guestName}&email=${guestName}@example.com&password=Password123`,
	});

	console.log("   [PASS] Host and Traveler authenticated.\n");

	// 3. Host creates a Property Listing
	console.log("3. Host creating property listing...");
	const createListingRes = await hostClient("/api/v1/listings", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			listing: {
				title: "Manali Snow Peak Chalet",
				description: "Cozy timber chalet surrounded by Himalayan pine forests.",
				price: 6000,
				location: "Manali",
				country: "India",
				category: "Mountains",
				propertyType: "Cabin",
				guests: 4,
			},
		}),
	});
	assert(createListingRes.status === 201, "Host must be able to create property");
	const testListing = createListingRes.json().data;
	const listingId = testListing._id;
	console.log(`   [PASS] Created property '${testListing.title}' with ID: ${listingId}.\n`);

	// 4. Traveler books the property (2 nights: 2 * 6000 = 12000 + 500 cleaning + 2250 tax = 14750)
	console.log("4. Traveler booking the property...");
	const bookRes = await guestClient(`/api/v1/listings/${listingId}/bookings`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			booking: {
				checkIn: "2026-12-20",
				checkOut: "2026-12-22",
				guests: 2,
			},
		}),
	});
	assert(bookRes.status === 201, "Booking should be created");
	const booking = bookRes.json().data;
	const bookingId = booking._id;
	assert(booking.totalPrice === 14750, `Expected total 14750, got ${booking.totalPrice}`);

	// Traveler pays for booking
	const payRes = await guestClient("/api/v1/payments/create-order", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			bookingId: bookingId,
			amount: 14750,
			paymentMethod: "card",
			cardHolderName: "Wanderer Guest",
		}),
	});
	assert(payRes.status === 201, "Payment must succeed");
	console.log(`   [PASS] Traveler reserved and paid ₹14,750 for booking ${bookingId}.\n`);

	// 5. Profile API Retrieval (GET /api/v1/users/profile)
	console.log("5. Testing Profile API Retrieval (GET /api/v1/users/profile)...");
	const guestProfileRes = await guestClient("/api/v1/users/profile");
	assert(guestProfileRes.status === 200, "Profile API must return HTTP 200");
	const guestData = guestProfileRes.json().data;
	assert(guestData.stats.tripsCount === 1, "Guest must have 1 trip counted");
	assert(guestData.recentTrips.length === 1, "Guest must have 1 recent trip listed");

	const hostProfileRes = await hostClient("/api/v1/users/profile");
	assert(hostProfileRes.status === 200, "Host Profile API must return HTTP 200");
	const hostData = hostProfileRes.json().data;
	assert(hostData.stats.listingsCount === 1, "Host must have 1 property counted");
	assert(hostData.stats.isHost === true, "Host flag must be true");
	const hostUserId = hostData.user._id;
	console.log("   [PASS] Profile API metrics verified for traveler and host.\n");

	// 6. Profile Details Update (PUT /api/v1/users/profile)
	console.log("6. Testing Profile Update (PUT /api/v1/users/profile)...");
	const updateRes = await guestClient("/api/v1/users/profile", {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			user: {
				fullName: "Aarav Sharma",
				bio: "Passionate globetrotter and nature enthusiast exploring mountain hideaways.",
				phone: "+91 9811223344",
				city: "Bengaluru",
				country: "India",
			},
		}),
	});
	assert(updateRes.status === 200, "Profile update should return HTTP 200");
	const updatedGuest = updateRes.json().data;
	assert(updatedGuest.fullName === "Aarav Sharma", "Full name must be updated");
	assert(updatedGuest.city === "Bengaluru", "City must be updated");
	console.log(`   [PASS] Profile successfully updated to '${updatedGuest.fullName}'.\n`);

	// 7. Web UI Profile Rendering (GET /profile)
	console.log("7. Testing Web UI Profile Rendering (GET /profile)...");
	const profileHtmlRes = await guestClient("/profile");
	assert(profileHtmlRes.status === 200, "Profile page must return HTTP 200");
	assert(profileHtmlRes.body.includes("Aarav Sharma"), "Profile page must display full name");
	assert(profileHtmlRes.body.includes("Passionate globetrotter"), "Profile page must display bio");
	assert(profileHtmlRes.body.includes("Bengaluru"), "Profile page must display city");
	assert(profileHtmlRes.body.includes("Manali Snow Peak Chalet"), "Profile must list recent trip");
	console.log("   [PASS] Web UI Profile page verified.\n");

	// 8. Web UI Edit Profile Rendering (GET /profile/edit)
	console.log("8. Testing Web UI Edit Profile Page (GET /profile/edit)...");
	const editHtmlRes = await guestClient("/profile/edit");
	assert(editHtmlRes.status === 200, "Edit profile page must return HTTP 200");
	assert(editHtmlRes.body.includes("name=\"user[fullName]\""), "Form must have fullName input");
	assert(editHtmlRes.body.includes("name=\"user[bio]\""), "Form must have bio input");
	assert(editHtmlRes.body.includes("name=\"newPassword\""), "Form must have newPassword input");
	console.log("   [PASS] Web UI Edit Profile page verified.\n");

	// 9. Password Change Workflow (POST /api/v1/users/change-password)
	console.log("9. Testing Account Password Change Workflow...");
	const pwChangeRes = await guestClient("/api/v1/users/change-password", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			currentPassword: "Password123",
			newPassword: "NewSecretPassword999",
			confirmPassword: "NewSecretPassword999",
		}),
	});
	assert(pwChangeRes.status === 200, "Password change must return HTTP 200");

	// Verify old password fails
	const oldLoginClient = createClient();
	const oldLoginRes = await oldLoginClient("/login", {
		method: "POST",
		body: `username=${guestName}&password=Password123`,
	});
	assert(
		oldLoginRes.status === 302 && oldLoginRes.headers.location === "/login",
		"Old password must fail authentication",
	);

	// Verify new password succeeds
	const newLoginClient = createClient();
	const newLoginRes = await newLoginClient("/login", {
		method: "POST",
		body: `username=${guestName}&password=NewSecretPassword999`,
	});
	assert(
		newLoginRes.status === 302 && newLoginRes.headers.location === "/listings",
		"New password must successfully authenticate",
	);
	console.log("   [PASS] Password update and re-authentication verified.\n");

	// 10. Host Dashboard Metrics API (GET /api/v1/host/metrics)
	console.log("10. Testing Host Dashboard Metrics API (GET /api/v1/host/metrics)...");
	const hostMetricsRes = await hostClient("/api/v1/host/metrics");
	assert(hostMetricsRes.status === 200, "Host metrics API must return HTTP 200");
	const hostDashboard = hostMetricsRes.json().data;
	assert(hostDashboard.metrics.totalListings === 1, "Must have 1 listing");
	assert(hostDashboard.metrics.totalBookings === 1, "Must have 1 booking");
	assert(hostDashboard.metrics.confirmedBookings === 1, "Must have 1 confirmed booking");
	assert(hostDashboard.metrics.totalRevenue === 14750, `Revenue must be 14750, got ${hostDashboard.metrics.totalRevenue}`);
	assert(hostDashboard.metrics.netEarnings === 13275, `Net earnings must be 13275, got ${hostDashboard.metrics.netEarnings}`);
	assert(hostDashboard.recentBookings.length === 1, "Must list recent booking");
	console.log("   [PASS] Host Dashboard Metrics verified.\n");

	// 11. Web UI Host Dashboard (GET /host/dashboard)
	console.log("11. Testing Web UI Host Dashboard (GET /host/dashboard)...");
	const hostDashWebRes = await hostClient("/host/dashboard");
	assert(hostDashWebRes.status === 200, "Host dashboard web view must return HTTP 200");
	assert(hostDashWebRes.body.includes("Host Performance Dashboard"), "Dashboard must show title");
	assert(hostDashWebRes.body.includes("14,750"), "Dashboard must show gross revenue 14,750");
	assert(hostDashWebRes.body.includes("13,275"), "Dashboard must show net payout 13,275");
	assert(hostDashWebRes.body.includes("Manali Snow Peak Chalet"), "Dashboard must show property");
	console.log("   [PASS] Web UI Host Dashboard verified.\n");

	// 12. Web UI Host Listings Management (GET /host/listings)
	console.log("12. Testing Web UI Host Listings View (GET /host/listings)...");
	const hostListingsWebRes = await hostClient("/host/listings");
	assert(hostListingsWebRes.status === 200, "Host listings view must return HTTP 200");
	assert(hostListingsWebRes.body.includes("Manage Host Properties"), "Page must show Manage Host Properties");
	assert(hostListingsWebRes.body.includes("Manali Snow Peak Chalet"), "Page must list property");
	console.log("   [PASS] Web UI Host Listings view verified.\n");

	// 13. Public Profile View (GET /users/:id)
	console.log("13. Testing Public User Profile View (GET /users/:id)...");
	const publicProfileRes = await anonClient(`/users/${hostUserId}`);
	assert(publicProfileRes.status === 200, "Public profile must return HTTP 200");
	assert(publicProfileRes.body.includes(hostName), "Public profile must show host username");
	assert(publicProfileRes.body.includes("Manali Snow Peak Chalet"), "Public profile must list hosted property");
	assert(!publicProfileRes.body.includes("/profile/edit"), "Anonymous viewer must NOT see edit controls");
	console.log("   [PASS] Public Profile View verified.\n");

	// 14. Access Control Guards (Unauthenticated access to protected pages)
	console.log("14. Testing Access Control Guards on Profile & Host Dashboards...");
	const anonProfileRes = await anonClient("/profile");
	assert(anonProfileRes.status === 302 && anonProfileRes.headers.location === "/login", "Protected /profile must redirect to /login");

	const anonDashRes = await anonClient("/host/dashboard");
	assert(anonDashRes.status === 302 && anonDashRes.headers.location === "/login", "Protected /host/dashboard must redirect to /login");

	const anonApiRes = await anonClient("/api/v1/users/profile");
	assert(anonApiRes.status === 302 || anonApiRes.status === 401, "API profile must reject unauthenticated request");
	console.log("   [PASS] Access control guards verified.\n");

	// 15. Cleanup Test Property
	console.log("15. Cleaning up test listing & data...");
	await hostClient(`/listings/${listingId}?_method=DELETE`, { method: "POST" });
	console.log("   [PASS] Cleaned up test property.\n");

	console.log("==========================================================");
	console.log("   ALL 15 PHASE 8 AUTOMATED TESTS PASSED SUCCESSFULLY!    ");
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

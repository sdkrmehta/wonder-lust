const http = require("http");
const path = require("path");
const { fork } = require("child_process");
const mongoose = require("mongoose");
const env = require("../config/env");

const PORT = 8092; // Dedicated port for Phase 12 test suite
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
	console.log("   WANDER-LUST PHASE 12 ADMIN & GOVERNANCE TEST SUITE     ");
	console.log("==========================================================\n");

	// 1. Spawning Wander-Lust server on port 8092
	console.log(`1. Starting Wander-Lust test server on port ${PORT}...`);
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
				reject(new Error(`Server exited prematurely with code ${code}`));
			}
		});
	});
	console.log(`   [PASS] Server ready on port ${PORT}.\n`);

	const adminClient = createClient();
	const hostClient = createClient();
	const travelerClient = createClient();
	const anonClient = createClient();

	const timestamp = Date.now();
	const adminUser = {
		username: `admin_p12_${timestamp}`,
		email: `admin_p12_${timestamp}@example.com`,
		password: "Password123!",
	};
	const hostUser = {
		username: `host_p12_${timestamp}`,
		email: `host_p12_${timestamp}@example.com`,
		password: "Password123!",
	};
	const travelerUser = {
		username: `traveler_p12_${timestamp}`,
		email: `traveler_p12_${timestamp}@example.com`,
		password: "Password123!",
	};

	// 2. Setting up accounts
	console.log("2. Setting up Admin, Host, and Traveler accounts...");
	await mongoose.connect(env.DB_URL);
	let res = await adminClient("/signup", {
		method: "POST",
		body: `username=${adminUser.username}&email=${adminUser.email}&password=${adminUser.password}`,
	});
	assert(res.status === 302, "Admin signup must succeed");

	res = await hostClient("/signup", {
		method: "POST",
		body: `username=${hostUser.username}&email=${hostUser.email}&password=${hostUser.password}`,
	});
	assert(res.status === 302, "Host signup must succeed");

	res = await travelerClient("/signup", {
		method: "POST",
		body: `username=${travelerUser.username}&email=${travelerUser.email}&password=${travelerUser.password}`,
	});
	assert(res.status === 302, "Traveler signup must succeed");

	// Elevate adminUser to admin role directly in database
	const User = require("../models/user");
	const adminDoc = await User.findOneAndUpdate(
		{ username: adminUser.username },
		{ role: "admin" },
		{ new: true },
	);
	assert(adminDoc.role === "admin", "Admin user role must be set to admin");
	console.log("   [PASS] Admin, Host, and Traveler accounts initialized.\n");

	// 3. Testing RBAC Security: Non-admin users cannot access admin endpoints
	console.log("3. Testing RBAC Security (Traveler & Anonymous blocked from Admin endpoints)...");
	// Traveler accessing web /admin
	const travelerWebRes = await travelerClient("/admin");
	assert(
		travelerWebRes.status === 302 && travelerWebRes.headers.location === "/listings",
		"Non-admin web access to /admin must redirect to /listings",
	);

	// Traveler accessing API /api/v1/admin/overview
	const travelerApiRes = await travelerClient("/api/v1/admin/overview");
	assert(travelerApiRes.status === 403, "Non-admin API access must return HTTP 403 Forbidden");

	// Anonymous accessing web /admin
	const anonWebRes = await anonClient("/admin");
	assert(
		anonWebRes.status === 302 && anonWebRes.headers.location === "/login",
		"Unauthenticated web access must redirect to /login",
	);

	// Anonymous accessing API /api/v1/admin/overview
	const anonApiRes = await anonClient("/api/v1/admin/overview");
	assert(anonApiRes.status === 401, "Unauthenticated API access must return HTTP 401 Unauthorized");
	console.log("   [PASS] RBAC access controls strictly verified (401 & 403 enforced).\n");

	// 4. Admin Dashboard Web View Rendering (GET /admin)
	console.log("4. Testing Admin Dashboard Web View Rendering (GET /admin)...");
	const adminDashRes = await adminClient("/admin");
	assert(adminDashRes.status === 200, "Admin dashboard must return HTTP 200");
	assert(adminDashRes.body.includes("Platform Governance"), "Must display Platform Governance header");
	assert(adminDashRes.body.includes("Gross Volume"), "Must display Gross Volume KPI card");
	assert(adminDashRes.body.includes("Reservations"), "Must display Reservations KPI card");
	assert(adminDashRes.body.includes("Properties"), "Must display Properties KPI card");
	assert(adminDashRes.body.includes("Platform Users"), "Must display Platform Users KPI card");
	console.log("   [PASS] Admin Dashboard Web View verified.\n");

	// 5. REST API v1 Overview Metrics (GET /api/v1/admin/overview)
	console.log("5. Testing REST API v1 Overview Metrics (GET /api/v1/admin/overview)...");
	const overviewRes = await adminClient("/api/v1/admin/overview");
	assert(overviewRes.status === 200, "Overview API must return HTTP 200");
	const metrics = overviewRes.json().data;
	assert(typeof metrics.users.total === "number", "metrics.users.total must be numeric");
	assert(typeof metrics.listings.total === "number", "metrics.listings.total must be numeric");
	assert(typeof metrics.bookings.total === "number", "metrics.bookings.total must be numeric");
	assert(typeof metrics.financials.grossBookingValue === "number", "grossBookingValue must be numeric");
	assert(typeof metrics.moderation.totalReviews === "number", "totalReviews must be numeric");
	console.log("   [PASS] REST API v1 Overview metrics schema verified.\n");

	// 6. User Directory Web UI (GET /admin/users)
	console.log("6. Testing User Directory Web UI (GET /admin/users)...");
	const usersWebRes = await adminClient("/admin/users");
	assert(usersWebRes.status === 200, "Users directory must return HTTP 200");
	assert(usersWebRes.body.includes("User Management &amp; Roles"), "Must display User Management header");
	assert(usersWebRes.body.includes(adminUser.username), "Must list admin user");
	assert(usersWebRes.body.includes(travelerUser.username), "Must list traveler user");
	console.log("   [PASS] User Directory Web UI verified.\n");

	// 7. REST API v1 Users List & Filtering (GET /api/v1/admin/users)
	console.log("7. Testing REST API v1 Users List & Filtering...");
	const usersApiRes = await adminClient(`/api/v1/admin/users?search=${travelerUser.username}`);
	assert(usersApiRes.status === 200, "Users API must return HTTP 200");
	const usersList = usersApiRes.json().data.users;
	assert(usersList.length >= 1, "Search should return matching traveler");
	assert(usersList[0].username === travelerUser.username, "Target username must match");
	const travelerId = usersList[0]._id;
	console.log(`   [PASS] API user search verified for traveler ID: ${travelerId}.\n`);

	// 8. Role Management via Admin API (PATCH /api/v1/admin/users/:id/role)
	console.log("8. Testing Role Modification via Admin API...");
	const promoteRes = await adminClient(`/api/v1/admin/users/${travelerId}/role`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ role: "host" }),
	});
	assert(promoteRes.status === 200, "Role promotion must return HTTP 200");
	assert(promoteRes.json().data.role === "host", "User role must be updated to host");

	// Test invalid role rejection
	const invalidRoleRes = await adminClient(`/api/v1/admin/users/${travelerId}/role`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ role: "superadmin_invalid" }),
	});
	assert(invalidRoleRes.status === 400, "Invalid role must be rejected with HTTP 400");
	console.log("   [PASS] Role modification and validation verified.\n");

	// 9. Superhost Badge Toggle via Admin API (PATCH /api/v1/admin/users/:id/superhost)
	console.log("9. Testing Superhost Badge Toggle via Admin API...");
	const superhostRes = await adminClient(`/api/v1/admin/users/${travelerId}/superhost`, {
		method: "PATCH",
	});
	assert(superhostRes.status === 200, "Superhost toggle must return HTTP 200");
	assert(superhostRes.json().data.isSuperhost === true, "User must now have isSuperhost = true");
	console.log("   [PASS] Superhost status toggled successfully.\n");

	// 10. Listings Governance Web UI (GET /admin/listings)
	console.log("10. Host creating listing and Admin inspecting Listings UI...");
	const createListingRes = await hostClient("/api/v1/listings", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			listing: {
				title: "Rishikesh Himalayan Riverside Camp",
				description: "Eco luxury retreat on the Ganges with yoga pavilion.",
				price: 3600,
				location: "Rishikesh",
				country: "India",
				category: "Camping",
				propertyType: "Other",
				guests: 4,
			},
		}),
	});
	assert(createListingRes.status === 201, "Host should create listing");
	const testListing = createListingRes.json().data;
	const listingId = testListing._id;

	const listingsWebRes = await adminClient("/admin/listings");
	assert(listingsWebRes.status === 200, "Admin listings UI must return HTTP 200");
	assert(listingsWebRes.body.includes("Rishikesh Himalayan Riverside Camp"), "UI must display test property");
	console.log(`   [PASS] Listing created (${listingId}) and rendered on Admin Listings UI.\n`);

	// 11. Listing Status Toggle via Admin API (PATCH /api/v1/admin/listings/:id/status)
	console.log("11. Testing Listing Status Toggle (Published vs Draft)...");
	const statusToggleRes1 = await adminClient(`/api/v1/admin/listings/${listingId}/status`, {
		method: "PATCH",
	});
	assert(statusToggleRes1.status === 200, "Status toggle must return HTTP 200");
	assert(statusToggleRes1.json().data.status === "draft", "Status must toggle to draft");

	const statusToggleRes2 = await adminClient(`/api/v1/admin/listings/${listingId}/status`, {
		method: "PATCH",
	});
	assert(statusToggleRes2.status === 200, "Status toggle must return HTTP 200");
	assert(statusToggleRes2.json().data.status === "published", "Status must toggle back to published");
	console.log("   [PASS] Listing publishing status toggling verified.\n");

	// 12. Review Creation & Content Moderation Queue
	console.log("12. Creating review and testing Flagged Content Moderation...");
	const revRes = await travelerClient(`/api/v1/listings/${listingId}/reviews`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			review: {
				rating: 2,
				comment: "Poor maintenance and excessive noise at night.",
				cleanliness: 2,
				accuracy: 3,
				communication: 2,
				location: 4,
				checkIn: 3,
				value: 2,
			},
		}),
	});
	assert(revRes.status === 201, "Review creation must succeed");
	const review = revRes.json().data;
	const reviewId = review._id;

	// Flag review for moderation
	const flagRes = await hostClient(`/api/v1/listings/${listingId}/reviews/${reviewId}/flag`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ reason: "Unfair review due to external construction noise" }),
	});
	assert(flagRes.status === 200, "Review flagging must succeed");

	// Verify Admin Web UI Moderation Queue
	const moderationWebRes = await adminClient("/admin/moderation");
	assert(moderationWebRes.status === 200, "Moderation Web UI must return HTTP 200");
	assert(moderationWebRes.body.includes("Flagged for Review"), "Must show flagged badge");
	assert(moderationWebRes.body.includes("Unfair review due to external construction noise"), "Must show report reason");
	console.log("   [PASS] Moderation Web UI rendered flagged review.\n");

	// 13. REST API v1 Moderation Queue (GET /api/v1/admin/moderation/reviews)
	console.log("13. Testing REST API v1 Moderation Queue...");
	const modApiRes = await adminClient("/api/v1/admin/moderation/reviews");
	assert(modApiRes.status === 200, "Moderation API must return HTTP 200");
	const flaggedList = modApiRes.json().data;
	assert(flaggedList.length >= 1, "Must contain at least 1 flagged review");
	const targetFlagged = flaggedList.find((r) => String(r._id) === String(reviewId));
	assert(targetFlagged, "Flagged review ID must exist in queue");
	assert(targetFlagged.isFlagged === true, "Review must be marked flagged");
	assert(targetFlagged.listing && targetFlagged.listing.title, "Parent listing must be populated");
	console.log("   [PASS] Moderation API returned flagged review with parent listing info.\n");

	// 14. Dismiss Review Flag via Admin API (PATCH /api/v1/admin/moderation/reviews/:id/dismiss)
	console.log("14. Testing Dismiss Review Flag (Approve Review)...");
	const dismissRes = await adminClient(`/api/v1/admin/moderation/reviews/${reviewId}/dismiss`, {
		method: "PATCH",
	});
	assert(dismissRes.status === 200, "Dismiss flag must return HTTP 200");
	assert(dismissRes.json().data.isFlagged === false, "isFlagged must be reset to false");

	// Verify queue is now empty
	const modApiAfterDismiss = await adminClient("/api/v1/admin/moderation/reviews");
	const remainingFlagged = modApiAfterDismiss.json().data.filter((r) => String(r._id) === String(reviewId));
	assert(remainingFlagged.length === 0, "Dismissed review must no longer appear in moderation queue");
	console.log("   [PASS] Review flag dismissed; removed from queue.\n");

	// 15. Admin Review Deletion (DELETE /api/v1/admin/moderation/reviews/:id)
	console.log("15. Testing Permanent Review Deletion as Admin...");
	const deleteRevRes = await adminClient(`/api/v1/admin/moderation/reviews/${reviewId}`, {
		method: "DELETE",
	});
	assert(deleteRevRes.status === 200, "Admin review deletion must return HTTP 200");
	console.log("   [PASS] Review removed permanently by administrator.\n");

	// 16. Admin Listing Deletion & Clean Teardown
	console.log("16. Testing Permanent Listing Deletion as Admin...");
	const deleteListingRes = await adminClient(`/api/v1/admin/listings/${listingId}`, {
		method: "DELETE",
	});
	assert(deleteListingRes.status === 200, "Admin listing deletion must return HTTP 200");
	console.log("   [PASS] Test listing deleted cleanly by administrator.\n");

	console.log("==========================================================");
	console.log("   ALL 16 PHASE 12 AUTOMATED TESTS PASSED SUCCESSFULLY!   ");
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
		try {
			await mongoose.disconnect();
		} catch (e) {}
		process.exit(exitCode);
	});

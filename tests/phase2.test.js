const http = require("http");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const env = require("../config/env");

const PORT = 8082; // Independent port for Phase 2 test suite
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

async function runTests() {
	console.log("==========================================================");
	console.log("   WONDER-LUST PHASE 2 BACKEND ARCHITECTURE TEST SUITE   ");
	console.log("==========================================================\n");

	// 1. Test App Decoupling & Config Unit Verification
	console.log("1. Testing Configuration Layer & App Decoupling...");
	assert(typeof env.PORT === "number", "env.PORT must be a number");
	assert(typeof env.DB_URL === "string" && env.DB_URL.includes("mongodb"), "env.DB_URL must be a mongodb URI");
	assert(typeof env.SESSION_SECRET === "string", "env.SESSION_SECRET must be defined");

	const appInstance = require("../app");
	assert(typeof appInstance.listen === "function", "app.js must export an Express application instance");
	console.log("   [PASS] Configuration validated and app.js cleanly exported without server auto-bind.");

	// 2. Start server instance via server.js on test port
	console.log(`2. Spawning server.js instance on port ${PORT}...`);
	const { spawn } = require("child_process");
	serverProc = spawn("node", ["server.js"], {
		cwd: path.join(__dirname, ".."),
		env: {
			...process.env,
			PORT: String(PORT),
			UPLOAD_STORAGE: process.env.TEST_UPLOAD_STORAGE || "local",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});

	let serverLogs = "";
	serverProc.stdout.on("data", (d) => (serverLogs += d.toString()));
	serverProc.stderr.on("data", (d) => (serverLogs += d.toString()));

	await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			serverProc.kill();
			reject(new Error("Timeout starting server.js:\n" + serverLogs));
		}, 10000);

		const interval = setInterval(() => {
			if (serverLogs.includes(`on port ${PORT}`)) {
				clearTimeout(timeout);
				clearInterval(interval);
				resolve();
			}
		}, 200);
	});
	console.log("   [PASS] server.js successfully started, connected to DB, and bound port.\n");

	const clientA = createClient();
	const clientB = createClient();

	// 3. Test REST API v1 Health Endpoint
	console.log("3. Testing REST API v1 Health Check (GET /api/v1/health)...");
	const apiHealthRes = await clientA("/api/v1/health", {
		headers: { Accept: "application/json" },
	});
	assert(apiHealthRes.status === 200, `Expected 200, got ${apiHealthRes.status}`);
	const apiHealthJson = apiHealthRes.json();
	assert(apiHealthJson && apiHealthJson.success === true, "Expected API success response structure");
	assert(apiHealthJson.data.version === "v1", "Expected API version 'v1'");
	assert(apiHealthJson.data.database === "connected", "Expected database 'connected'");
	console.log("   [PASS] REST API v1 returns standardized JSend/ApiResponse format.");

	// 4. Test REST API v1 Listings Endpoint
	console.log("4. Testing REST API v1 Listings (GET /api/v1/listings)...");
	const apiListingsRes = await clientA("/api/v1/listings", {
		headers: { Accept: "application/json" },
	});
	assert(apiListingsRes.status === 200, `Expected 200, got ${apiListingsRes.status}`);
	const apiListingsJson = apiListingsRes.json();
	assert(apiListingsJson.data && Array.isArray(apiListingsJson.data.listings), "Expected listings array");
	assert(typeof apiListingsJson.data.count === "number", "Expected count property in listings data");
	console.log(`   [PASS] REST API v1 retrieved ${apiListingsJson.data.count} listings successfully.`);

	// 5. Test Service Layer: UserService Direct Registration
	console.log("5. Testing UserService Direct Execution...");
	await mongoose.connect(env.DB_URL);
	const UserService = require("../services/user.service");
	const ListingService = require("../services/listing.service");
	const ReviewService = require("../services/review.service");
	const User = require("../models/user");

	const serviceTestUser = "service_user_" + Date.now();
	const registeredUser = await UserService.registerUser({
		username: serviceTestUser,
		email: `${serviceTestUser}@example.com`,
		password: "ServicePassword123!",
	});
	assert(registeredUser && registeredUser._id, "UserService failed to register user");
	console.log(`   [PASS] UserService successfully registered user '${serviceTestUser}'.`);

	// 6. Test Service Layer: ListingService Direct Operations
	console.log("6. Testing ListingService Direct CRUD Operations...");
	const serviceListing = await ListingService.createListing(
		{
			title: "Architectural Villa in Kyoto",
			description: "Zen retreat with traditional garden.",
			price: 3800,
			location: "Kyoto",
			country: "Japan",
			category: "Rooms",
		},
		null,
		registeredUser,
	);
	assert(serviceListing && serviceListing._id, "ListingService failed to create listing");
	console.log(`   [PASS] ListingService created listing ID: ${serviceListing._id}`);

	const fetchedListing = await ListingService.getListingById(serviceListing._id);
	assert(fetchedListing.title === "Architectural Villa in Kyoto", "Fetched title mismatch");
	assert(fetchedListing.owner.username === serviceTestUser, "Owner not populated correctly");
	console.log("   [PASS] ListingService retrieved and populated listing.");

	// 7. Test Service Layer: ReviewService Direct Operations
	console.log("7. Testing ReviewService Direct Review Operations...");
	const serviceReview = await ReviewService.createReview(
		serviceListing._id,
		{ rating: 5, comment: "Peaceful and serene experience." },
		registeredUser,
	);
	assert(serviceReview && serviceReview._id, "ReviewService failed to create review");

	const listingWithRev = await ListingService.getListingById(serviceListing._id);
	assert(listingWithRev.reviews.length === 1, "Review was not attached to listing");
	console.log("   [PASS] ReviewService attached review and updated listing relations.");

	await ReviewService.deleteReview(serviceListing._id, serviceReview._id);
	const listingAfterRevDel = await ListingService.getListingById(serviceListing._id);
	assert(listingAfterRevDel.reviews.length === 0, "Review was not detached on deletion");
	console.log("   [PASS] ReviewService detached and deleted review cleanly.");

	await ListingService.deleteListing(serviceListing._id);
	let notFoundCaught = false;
	try {
		await ListingService.getListingById(serviceListing._id);
	} catch (e) {
		notFoundCaught = true;
	}
	assert(notFoundCaught, "Expected getListingById to throw AppError.notFound after deletion");
	console.log("   [PASS] ListingService deleted listing cleanly.");

	// Clean up service user
	await User.deleteOne({ _id: registeredUser._id });
	await mongoose.disconnect();

	// 8. Test HTTP Client Integration: User A Registration, Login, Logout
	console.log("8. Testing HTTP Authentication Workflow via Modular Controllers...");
	const userA = "arch_host_" + Date.now();
	const signupResA = await clientA("/signup", {
		method: "POST",
		body: `username=${userA}&email=${userA}@example.com&password=SecurePassword123!`,
	});
	assert(signupResA.status === 302, `Expected 302, got ${signupResA.status}`);
	console.log(`   [PASS] User A (${userA}) signed up and authenticated.`);

	// 9. Test HTTP Client: Listing Creation via New Architecture
	console.log("9. Testing HTTP Listing Creation via Controller & Service Layer...");
	const boundary = "----ArchBoundary" + Math.random().toString(36).substring(2);
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
				`--${boundary}\r\nContent-Disposition: form-data; name="listing[image]"; filename="palace_${i}.png"\r\nContent-Type: image/png\r\n\r\n`,
			),
			dummyPng,
			Buffer.from("\r\n"),
		);
	}

	const multipartPayload = Buffer.concat([
		Buffer.from(
			`--${boundary}\r\nContent-Disposition: form-data; name="listing[title]"\r\n\r\nHeritage Palace Udaipur\r\n` +
			`--${boundary}\r\nContent-Disposition: form-data; name="listing[description]"\r\n\r\nRoyal stay with lake view.\r\n` +
			`--${boundary}\r\nContent-Disposition: form-data; name="listing[price]"\r\n\r\n6500\r\n` +
			`--${boundary}\r\nContent-Disposition: form-data; name="listing[location]"\r\n\r\nUdaipur\r\n` +
			`--${boundary}\r\nContent-Disposition: form-data; name="listing[country]"\r\n\r\nIndia\r\n` +
			`--${boundary}\r\nContent-Disposition: form-data; name="listing[category]"\r\n\r\nCastles\r\n`
		),
		...imageParts,
		Buffer.from(`--${boundary}--\r\n`),
	]);

	const createRes = await clientA("/listings", {
		method: "POST",
		headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
		body: multipartPayload,
	});
	assert(createRes.status === 302, `Expected 302, got ${createRes.status}`);
	const newListingId = createRes.headers.location.split("/").pop();
	console.log(`   [PASS] Created listing ${newListingId} via controller/service.`);

	// 10. Test REST API v1 Fetching the Created Listing
	console.log("10. Testing REST API v1 Fetching Created Listing (GET /api/v1/listings/:id)...");
	const apiGetRes = await clientA(`/api/v1/listings/${newListingId}`, {
		headers: { Accept: "application/json" },
	});
	assert(apiGetRes.status === 200, `Expected 200, got ${apiGetRes.status}`);
	const apiGetJson = apiGetRes.json();
	assert(apiGetJson.data.title === "Heritage Palace Udaipur", "API title mismatch");
	assert(apiGetJson.data.owner.username === userA, "API owner mismatch");
	console.log("   [PASS] REST API v1 correctly returned listing JSON data.");

	// 11. Test Error Handling Architecture: API JSON error for invalid ID
	console.log("11. Testing Centralized Error Handler (API JSON 404 for invalid ID)...");
	const api404Res = await clientA("/api/v1/listings/nonexistent-invalid-id", {
		headers: { Accept: "application/json" },
	});
	assert(api404Res.status === 404, `Expected 404, got ${api404Res.status}`);
	const api404Json = api404Res.json();
	assert(api404Json.success === false, "Expected success: false in error response");
	assert(api404Json.status === "fail", "Expected status: 'fail'");
	console.log("   [PASS] Centralized error middleware routed API error to structured JSON.");

	// 12. Clean up created HTTP listing
	console.log("12. Cleaning up test listing via HTTP DELETE...");
	const delRes = await clientA(`/listings/${newListingId}?_method=DELETE`, {
		method: "POST",
	});
	assert(delRes.status === 302, "Expected 302 on deletion");

	await mongoose.connect(env.DB_URL);
	await User.deleteOne({ username: userA });
	await mongoose.disconnect();
	console.log("   [PASS] Cleaned up test data.");

	console.log("\n==========================================================");
	console.log("      ALL 12 PHASE 2 TESTS PASSED (100% SUCCESS)         ");
	console.log("==========================================================");
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

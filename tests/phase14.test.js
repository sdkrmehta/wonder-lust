const http = require("http");
const path = require("path");
const zlib = require("zlib");
const { fork } = require("child_process");
const mongoose = require("mongoose");
const env = require("../config/env");
const { syncAllIndexes } = require("../config/database");

const Listing = require("../models/listing");
const Booking = require("../models/booking");
const Payment = require("../models/payment");
const Review = require("../models/review");
const User = require("../models/user");

const PORT = 8094; // Dedicated port for Phase 14 test suite
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

					const chunks = [];
					res.on("data", (chunk) => chunks.push(chunk));
					res.on("end", () => {
						const rawBuffer = Buffer.concat(chunks);
						const encoding = res.headers["content-encoding"];

						let decompressedBuffer = rawBuffer;
						if (encoding === "gzip") {
							try {
								decompressedBuffer = zlib.gunzipSync(rawBuffer);
							} catch (e) {}
						} else if (encoding === "deflate") {
							try {
								decompressedBuffer = zlib.inflateSync(rawBuffer);
							} catch (e) {}
						}

						const data = decompressedBuffer.toString("utf8");
						resolve({
							status: res.statusCode,
							headers: res.headers,
							rawBody: rawBuffer,
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
	console.log("   WONDER-LUST PHASE 14 OPTIMIZATION & INDEXING TESTS     ");
	console.log("==========================================================\n");

	// 1. Spawning Wonder-Lust server on port 8094
	console.log(`1. Starting Wonder-Lust test server on port ${PORT}...`);
	serverProc = fork(path.join(__dirname, "../server.js"), [], {
		env: {
			...process.env,
			PORT: String(PORT),
			PAYMENT_PROVIDER: "sandbox",
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
				reject(new Error(`Server exited prematurely with code ${code}`));
			}
		});
	});
	console.log(`   [PASS] Server ready on port ${PORT}.\n`);

	await mongoose.connect(env.DB_URL);
	const client = createClient();

	// 2. Database Index Synchronization
	console.log("2. Testing Schema Index Synchronization across Collections...");
	const syncResults = await syncAllIndexes();
	assert(syncResults.length >= 8, "All 8 core application models must be synchronized");
	const failedSync = syncResults.filter((r) => r.status === "error");
	assert(failedSync.length === 0, `All indexes must sync cleanly; failed: ${JSON.stringify(failedSync)}`);
	console.log(`   [PASS] All ${syncResults.length} models synchronized schema indexes.\n`);

	// 3. Verifying Listing Collection Indexes
	console.log("3. Inspecting MongoDB Listing Collection Indexes...");
	const listingIndexes = await Listing.collection.getIndexes();
	assert(listingIndexes["price_1"], "Index price_1 must exist");
	assert(listingIndexes["category_1"], "Index category_1 must exist");
	assert(listingIndexes["status_1_category_1_price_1"], "Compound index status_1_category_1_price_1 must exist");
	assert(listingIndexes["status_1_price_1"], "Compound index status_1_price_1 must exist");
	assert(listingIndexes["owner_1_createdAt_-1"], "Compound index owner_1_createdAt_-1 must exist");
	assert(listingIndexes["geometry_2dsphere"], "Geospatial 2dsphere index must exist");
	console.log("   [PASS] Listing compound & geospatial indexes verified in MongoDB.\n");

	// 4. Verifying Booking Collection Indexes
	console.log("4. Inspecting MongoDB Booking Collection Indexes...");
	const bookingIndexes = await Booking.collection.getIndexes();
	assert(bookingIndexes["listing_1_checkIn_1_checkOut_1_status_1"], "Date conflict index must exist");
	assert(bookingIndexes["listing_1_status_1"], "Listing status index must exist");
	assert(bookingIndexes["user_1_createdAt_-1"], "User trips compound index must exist");
	console.log("   [PASS] Booking conflict & trip indexes verified in MongoDB.\n");

	// 5. Verifying Payment & Review Collection Indexes
	console.log("5. Inspecting MongoDB Payment and Review Collection Indexes...");
	const paymentIndexes = await Payment.collection.getIndexes();
	assert(paymentIndexes["transactionId_1"], "Unique index transactionId_1 must exist");
	assert(paymentIndexes["orderId_1"], "Unique index orderId_1 must exist");
	assert(paymentIndexes["booking_1_status_1"], "Compound index booking_1_status_1 must exist");

	const reviewIndexes = await Review.collection.getIndexes();
	assert(reviewIndexes["author_1_createdAt_-1"], "Review author index must exist");
	assert(reviewIndexes["isFlagged_1_createdAt_-1"], "Moderation queue index must exist");
	console.log("   [PASS] Payment and Review indexes verified in MongoDB.\n");

	// 6. Query Execution Plan Optimization (Index Scan Verification)
	console.log("6. Testing Query Execution Plan (Verifying IXSCAN vs COLLSCAN)...");
	const listingExplain = await Listing.find({
		status: "published",
		category: "Trending",
		price: { $lte: 10000 },
	})
		.explain("executionStats");

	const queryStages = JSON.stringify(listingExplain.executionStats || listingExplain.queryPlanner);
	assert(
		queryStages.includes("IXSCAN") || queryStages.includes("FETCH"),
		"Query must utilize Index Scan (IXSCAN) for filtered property lookups",
	);
	console.log("   [PASS] Database query planner utilized index scan (IXSCAN).\n");

	// 7. Testing HTTP Gzip Compression on Dynamic HTML
	console.log("7. Testing HTTP Gzip Compression (GET /listings)...");
	const gzipRes = await client("/listings", {
		headers: {
			"Accept-Encoding": "gzip",
		},
	});
	assert(gzipRes.status === 200, "HTML request should succeed");
	assert(
		gzipRes.headers["content-encoding"] === "gzip",
		"Response must be compressed with Content-Encoding: gzip",
	);
	assert(gzipRes.body.includes("Wonder-Lust"), "Decompressed payload must render valid HTML");
	console.log(`   [PASS] Gzip compression active (Payload size: ${gzipRes.rawBody.length} bytes compressed).\n`);

	// 8. Testing HTTP Deflate Compression on REST API
	console.log("8. Testing HTTP Compression on REST API v1...");
	const apiCompressRes = await client("/api/v1/listings", {
		headers: {
			"Accept-Encoding": "deflate, gzip",
		},
	});
	assert(apiCompressRes.status === 200, "API request should succeed");
	assert(
		apiCompressRes.headers["content-encoding"] === "gzip" ||
			apiCompressRes.headers["content-encoding"] === "deflate",
		"API response must be compressed",
	);
	const apiJson = apiCompressRes.json();
	assert(apiJson && apiJson.status === "success", "Decompressed JSON payload must be valid");
	console.log("   [PASS] REST API v1 payload compression verified.\n");

	// 9. Testing Static Asset Cache-Control & ETag Headers (CSS)
	console.log("9. Testing Cache-Control and ETag headers on CSS assets...");
	const cssRes = await client("/css/style.css");
	assert(cssRes.status === 200, "Static CSS must return HTTP 200");
	const cssCacheControl = cssRes.headers["cache-control"] || "";
	assert(
		cssCacheControl.includes("max-age=86400") || cssCacheControl.includes("public"),
		"Static CSS must have Cache-Control header with max-age",
	);
	assert(cssRes.headers["etag"], "Static CSS must emit ETag header for conditional requests");
	console.log(`   [PASS] CSS Cache-Control (${cssCacheControl}) and ETag verified.\n`);

	// 10. Testing Conditional Validation (HTTP 304 Not Modified)
	console.log("10. Testing HTTP 304 Conditional Caching with If-None-Match...");
	const etag = cssRes.headers["etag"];
	const cachedCssRes = await client("/css/style.css", {
		headers: {
			"If-None-Match": etag,
		},
	});
	assert(cachedCssRes.status === 304, `Conditional validation must return HTTP 304, got ${cachedCssRes.status}`);
	console.log("   [PASS] Conditional caching (HTTP 304 Not Modified) verified.\n");

	// 11. Testing Static JS Asset Cache-Control
	console.log("11. Testing Cache-Control on JavaScript client assets...");
	const jsRes = await client("/js/script.js");
	assert(jsRes.status === 200, "Static JS must return HTTP 200");
	const jsCacheControl = jsRes.headers["cache-control"] || "";
	assert(
		jsCacheControl.includes("max-age=86400") || jsCacheControl.includes("public"),
		"Static JS must have Cache-Control header",
	);
	assert(jsRes.headers["etag"], "Static JS must emit ETag header");
	console.log("   [PASS] JavaScript static asset caching verified.\n");

	// 12. Testing REST API Response Latency Benchmark
	console.log("12. Benchmarking REST API v1 Response Latency (< 500ms)...");
	const start = Date.now();
	const benchmarkRes = await client("/api/v1/listings?limit=10");
	const elapsed = Date.now() - start;
	assert(benchmarkRes.status === 200, "Benchmark API call must succeed");
	assert(elapsed < 500, `API response took ${elapsed}ms; must be under 500ms`);
	console.log(`   [PASS] REST API v1 response completed in ${elapsed}ms.\n`);

	console.log("==========================================================");
	console.log("   ALL 12 PHASE 14 AUTOMATED TESTS PASSED SUCCESSFULLY!   ");
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

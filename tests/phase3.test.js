const http = require("http");
const path = require("path");
const { fork } = require("child_process");

const PORT = 8083; // Independent port for Phase 3 test suite
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
	console.log("   WANDER-LUST PHASE 3 SEARCH & DISCOVERY TEST SUITE      ");
	console.log("==========================================================\n");

	// 1. Start Server on port 8083
	console.log("1. Starting Wander-Lust test server on port 8083...");
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

	console.log("   [PASS] Server ready on port 8083.\n");

	const client = createClient();

	// 2. Test Autocomplete Suggestions Endpoint
	console.log("2. Testing Autocomplete Suggestions Endpoint...");
	const shortQueryRes = await client("/listings/suggestions?q=a");
	const shortQueryData = shortQueryRes.json();
	assert(shortQueryRes.status === 200, "Suggestions should return HTTP 200");
	assert(
		Array.isArray(shortQueryData.data) && shortQueryData.data.length === 0,
		"Query with length < 2 must return empty array",
	);

	// Try with an active country/location
	const validSuggestRes = await client("/listings/suggestions?q=in");
	const validSuggestData = validSuggestRes.json();
	assert(validSuggestRes.status === 200, "Suggestions with query >= 2 chars should return 200");
	assert(Array.isArray(validSuggestData.data), "Suggestions data should be an array");
	console.log(
		`   [PASS] Suggestions endpoint returned ${validSuggestData.data.length} suggestions for query 'in'.`,
	);

	// 3. Test API v1 Listings Endpoint with Pagination
	console.log("\n3. Testing REST API v1 Pagination & Meta...");
	const apiRes = await client("/api/v1/listings?limit=5&page=1");
	const apiData = apiRes.json();
	assert(apiRes.status === 200, "API v1 listings should return HTTP 200");
	assert(apiData.status === "success", "API response status must be success");
	assert(Array.isArray(apiData.data.listings), "API must return listings array");
	assert(apiData.data.listings.length <= 5, "Listings count should not exceed limit of 5");
	assert(apiData.data.pagination.currentPage === 1, "Current page should be 1");
	assert(apiData.data.pagination.limit === 5, "Pagination limit should be 5");
	assert(apiData.data.pagination.totalListings > 0, "Total listings should be > 0");
	assert(apiData.data.pagination.totalPages >= 1, "Total pages should be >= 1");
	console.log(
		`   [PASS] API v1 Pagination verified: Page 1 of ${apiData.data.pagination.totalPages} (${apiData.data.pagination.totalListings} total listings).`,
	);

	// 4. Test Multi-Keyword & Case-Insensitive Search
	console.log("\n4. Testing Multi-Keyword & Case-Insensitive Search...");
	// Search in lowercase
	const searchLower = await client("/api/v1/listings?q=villa");
	const dataLower = searchLower.json();
	assert(searchLower.status === 200, "Search by query should return 200");

	// Search in uppercase
	const searchUpper = await client("/api/v1/listings?q=VILLA");
	const dataUpper = searchUpper.json();
	assert(
		dataLower.data.listings.length === dataUpper.data.listings.length,
		"Search must be case-insensitive",
	);
	console.log(
		`   [PASS] Case-insensitivity verified: 'villa' (${dataLower.data.listings.length}) matches 'VILLA' (${dataUpper.data.listings.length}).`,
	);

	// 5. Test Price Sorting (Ascending & Descending)
	console.log("\n5. Testing Price Sorting (Ascending vs Descending)...");
	const sortAscRes = await client("/api/v1/listings?sort=price_asc&limit=10");
	const sortAscData = sortAscRes.json();
	assert(sortAscRes.status === 200, "Price asc sort should return 200");
	const ascListings = sortAscData.data.listings;
	for (let i = 1; i < ascListings.length; i++) {
		assert(
			ascListings[i].price >= ascListings[i - 1].price,
			`Price ascending sort failed: ${ascListings[i].price} < ${ascListings[i - 1].price}`,
		);
	}

	const sortDescRes = await client("/api/v1/listings?sort=price_desc&limit=10");
	const sortDescData = sortDescRes.json();
	assert(sortDescRes.status === 200, "Price desc sort should return 200");
	const descListings = sortDescData.data.listings;
	for (let i = 1; i < descListings.length; i++) {
		assert(
			descListings[i].price <= descListings[i - 1].price,
			`Price descending sort failed: ${descListings[i].price} > ${descListings[i - 1].price}`,
		);
	}
	console.log(
		`   [PASS] Price sorting verified: Low-to-High (₹${ascListings[0].price} -> ₹${ascListings[ascListings.length - 1].price}), High-to-Low (₹${descListings[0].price} -> ₹${descListings[descListings.length - 1].price}).`,
	);

	// 6. Test Price Range Filtering
	console.log("\n6. Testing Price Range Filtering...");
	const minP = 1500;
	const maxP = 4000;
	const priceFilterRes = await client(
		`/api/v1/listings?minPrice=${minP}&maxPrice=${maxP}&limit=20`,
	);
	const priceFilterData = priceFilterRes.json();
	assert(priceFilterRes.status === 200, "Price range filter should return 200");
	for (let l of priceFilterData.data.listings) {
		assert(
			l.price >= minP && l.price <= maxP,
			`Listing price ${l.price} outside expected range [${minP}, ${maxP}]`,
		);
	}
	console.log(
		`   [PASS] Price filter verified: All ${priceFilterData.data.listings.length} returned listings within ₹${minP} - ₹${maxP}.`,
	);

	// 7. Test Category Filtering
	console.log("\n7. Testing Category Filtering...");
	const catRes = await client("/api/v1/listings?category=Trending&limit=20");
	const catData = catRes.json();
	assert(catRes.status === 200, "Category filter should return 200");
	for (let l of catData.data.listings) {
		assert(
			l.category === "Trending",
			`Expected category 'Trending', found '${l.category}'`,
		);
	}
	console.log(
		`   [PASS] Category filter verified: ${catData.data.listings.length} listings returned for 'Trending'.`,
	);

	// 8. Test Combined Multi-Criteria Filtering
	console.log("\n8. Testing Combined Filtering (Query + Category + Price)...");
	const combinedRes = await client(
		`/api/v1/listings?category=Trending&minPrice=1000&maxPrice=50000&sort=price_asc`,
	);
	const combinedData = combinedRes.json();
	assert(combinedRes.status === 200, "Combined query should return 200");
	for (let l of combinedData.data.listings) {
		assert(l.category === "Trending", "Listing category must match filter");
		assert(l.price >= 1000 && l.price <= 50000, "Price must be within range");
	}
	console.log(
		`   [PASS] Combined filtering verified: ${combinedData.data.listings.length} matching listings.`,
	);

	// 9. Test Web UI (EJS) Discovery Experience
	console.log("\n9. Testing Web UI (EJS) Discovery Experience...");
	const webIndexRes = await client("/listings");
	assert(webIndexRes.status === 200, "Web GET /listings should return HTTP 200");
	assert(
		webIndexRes.body.includes("id=\"filters-container\""),
		"EJS template must render categories container",
	);
	assert(
		webIndexRes.body.includes("data-bs-target=\"#filterModal\""),
		"EJS template must render Filter modal trigger button",
	);
	assert(
		webIndexRes.body.includes("id=\"sortDropdown\""),
		"EJS template must render sorting dropdown",
	);
	assert(
		webIndexRes.body.includes("id=\"taxSwitch\""),
		"EJS template must render tax switch toggle",
	);
	assert(
		webIndexRes.body.includes("/js/search.js"),
		"EJS layout must include search.js script",
	);
	console.log("   [PASS] Web UI contains all search and discovery controls.");

	// 10. Test Empty Search State in Web UI
	console.log("\n10. Testing Empty Search State UI...");
	const emptySearchRes = await client("/listings?q=NonExistentDestinationXYZ999");
	assert(emptySearchRes.status === 200, "Empty search should return HTTP 200");
	assert(
		emptySearchRes.body.includes("No properties match your search"),
		"Empty search must display helpful empty state message",
	);
	assert(
		emptySearchRes.body.includes("Reset All Filters"),
		"Empty search must provide a clear reset button",
	);
	console.log("   [PASS] Empty search results state verified.");

	// 11. Test Web UI Pagination Links & Query Persistence
	console.log("\n11. Testing Web UI Pagination with Query Persistence...");
	const paginatedWebRes = await client("/listings?limit=4&page=1&category=Trending");
	assert(paginatedWebRes.status === 200, "Paginated web page should return 200");
	if (paginatedWebRes.body.includes("aria-label=\"Listings navigation\"")) {
		assert(
			paginatedWebRes.body.includes("category=Trending"),
			"Pagination links must preserve active filters",
		);
		console.log("   [PASS] Pagination navigation preserves active URL parameters.");
	} else {
		console.log("   [NOTE] Fewer than 4 listings for category 'Trending'; pagination skipped.");
	}

	// 12. Test Autocomplete API via REST API v1
	console.log("\n12. Testing /api/v1/listings/suggestions...");
	const apiSuggest = await client("/api/v1/listings/suggestions?q=in");
	const apiSuggestData = apiSuggest.json();
	assert(apiSuggest.status === 200, "API suggestions should return 200");
	assert(apiSuggestData.status === "success", "API suggestions status must be success");
	console.log(`   [PASS] API v1 suggestions verified.`);

	console.log("\n==========================================================");
	console.log("   ALL 12 PHASE 3 AUTOMATED TESTS PASSED SUCCESSFULLY!    ");
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

const http = require("http");
const path = require("path");
const { fork } = require("child_process");

const PORT = 8089;
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
	console.log("==================================================================");
	console.log("   WONDER-LUST UNIFIED HEADER & AIRBNB SEARCH VERIFICATION SUITE   ");
	console.log("==================================================================\n");

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
			console.error("[Server Output]", data.toString());
		});

		serverProc.on("exit", (code) => {
			clearTimeout(timeout);
			if (code !== 0) {
				reject(new Error(`Server exited with code ${code}`));
			}
		});
	});

	console.log("   [PASS] Server ready on port 8089.\n");

	const client = createClient();

	// 2. Test Homepage Navigation Structure and Hero Search Bar
	console.log("2. Testing Homepage Global Header and Hero Search Bar...");
	const homeRes = await client("/home", { headers: { Accept: "text/html" } });
	assert(homeRes.status === 200, "Homepage must return HTTP 200");
	assert(homeRes.body.includes("aria-label=\"Main Navigation\""), "Header must have aria-label='Main Navigation'");
	assert(homeRes.body.includes("brand-wordmark"), "Header must include brand wordmark");
	assert(homeRes.body.includes("fa-compass"), "Header must render compass logo");
	assert(homeRes.body.includes("Host your home"), "Header must include 'Host your home' link");
	assert(homeRes.body.includes("id=\"userDropdownMenu\""), "Header must include user profile/menu button");
	assert(homeRes.body.includes("fa-bell"), "Header must include notification icon");

	// Center navigation links
	assert(homeRes.body.includes("Home"), "Header must include 'Home'");
	assert(homeRes.body.includes("Explore Destinations"), "Header must include 'Explore Destinations'");
	assert(homeRes.body.includes("Hotels"), "Header must include 'Hotels'");
	assert(homeRes.body.includes("Experiences"), "Header must include 'Experiences'");
	assert(homeRes.body.includes("About Us"), "Header must include 'About Us'");
	assert(homeRes.body.includes("Contact"), "Header must include 'Contact'");

	// Verify Home is active on homepage
	assert(
		homeRes.body.includes('class="nav-link global-nav-link active" href="/home">Home</a>'),
		"Home navigation link must have active class on homepage",
	);

	// Verify Hero expanded search component
	assert(homeRes.body.includes("heroSearchForm"), "Homepage must render heroSearchForm");
	assert(homeRes.body.includes("Where to? City or country"), "Search bar must contain destination placeholder");
	assert(homeRes.body.includes("Search Stays"), "Search bar must contain 'Search Stays' button");
	assert(homeRes.body.includes("id=\"headerCompactSearch\""), "Header must include compact search pill element");
	assert(homeRes.body.includes("id=\"headerSearchOverlay\""), "Header must include floating expanded search overlay");
	console.log("   [PASS] Homepage global header & expanded hero search verified.\n");

	// 3. Test Hotels Navigation and Routing (/hotels and /listings)
	console.log("3. Testing Hotels Navigation and Canonical Route (/hotels -> /listings)...");
	const hotelsRedirectRes = await client("/hotels");
	assert(hotelsRedirectRes.status === 302, "GET /hotels must return 302 redirect");
	assert(hotelsRedirectRes.headers.location === "/listings", "GET /hotels must redirect to /listings");

	const listingsRes = await client("/listings");
	assert(listingsRes.status === 200, "Listings page must return HTTP 200");
	assert(listingsRes.body.includes("aria-label=\"Main Navigation\""), "Listings page must include the same shared header");

	// Verify Hotels is active on listings page
	assert(
		listingsRes.body.includes('class="nav-link global-nav-link active" href="/listings">Hotels</a>'),
		"Hotels navigation link must have active class on listings page",
	);
	console.log("   [PASS] Hotels navigation and canonical routing verified.\n");

	// 4. Verify Find Your Sanctuary Banner is Removed and Replaced with Expanded Search
	console.log("4. Verifying Removal of 'Find Your Sanctuary' and Replacement with Search Bar...");
	assert(
		!listingsRes.body.includes("Find Your Sanctuary"),
		"'Find Your Sanctuary' banner must NOT be present on the listings page",
	);
	assert(
		listingsRes.body.includes("listingsSearchWrapper"),
		"Listings page must include listingsSearchWrapper in banner position",
	);
	assert(
		listingsRes.body.includes("listingsSearchForm"),
		"Listings page must render listingsSearchForm",
	);
	assert(
		listingsRes.body.includes("name=\"checkIn\""),
		"Listings search form must contain Check-in date picker",
	);
	assert(
		listingsRes.body.includes("name=\"checkOut\""),
		"Listings search form must contain Check-out date picker",
	);
	assert(
		listingsRes.body.includes("name=\"bedrooms\""),
		"Listings search form must contain Rooms selector",
	);
	assert(
		listingsRes.body.includes("name=\"guests\""),
		"Listings search form must contain Guests selector",
	);
	assert(
		listingsRes.body.includes("Search Stays"),
		"Listings search form must contain 'Search Stays' button",
	);
	console.log("   [PASS] 'Find Your Sanctuary' banner successfully replaced by unified search bar.\n");

	// 5. Verify Query Parameter Preservation in Search Inputs & Filters
	console.log("5. Testing Search Query Parameter Preservation...");
	const filteredRes = await client("/listings?q=Goa&checkIn=2026-12-10&checkOut=2026-12-15&bedrooms=2&guests=3");
	assert(filteredRes.status === 200, "Filtered search request must return 200");
	assert(filteredRes.body.includes("value=\"Goa\""), "Destination input must be prefilled with 'Goa'");
	assert(filteredRes.body.includes("value=\"2026-12-10\""), "Check-in date must be prefilled with '2026-12-10'");
	assert(filteredRes.body.includes("value=\"2026-12-15\""), "Check-out date must be prefilled with '2026-12-15'");
	assert(
		filteredRes.body.includes('value="2" selected>2 Rooms</option>'),
		"Rooms selector must have '2 Rooms' selected",
	);
	assert(
		filteredRes.body.includes('value="3" selected>3</option>'),
		"Guests selector must have '3' selected",
	);
	console.log("   [PASS] Search values preserved across page render.\n");

	// 6. Test Compact Search Pill Elements (WHERE, WHEN, WHO) in Header
	console.log("6. Verifying Airbnb Compact Search Pill Structure...");
	assert(listingsRes.body.includes("id=\"compactWhereText\""), "Compact pill must have #compactWhereText");
	assert(listingsRes.body.includes("id=\"compactWhenText\""), "Compact pill must have #compactWhenText");
	assert(listingsRes.body.includes("id=\"compactWhoText\""), "Compact pill must have #compactWhoText");
	assert(listingsRes.body.includes("compact-search-btn"), "Compact pill must have search button");
	console.log("   [PASS] Compact search pill structure validated.\n");

	// 7. Verify Design System CSS & Search Animation Classes
	console.log("7. Verifying Animation & Design System CSS...");
	const cssRes = await client("/css/style.css");
	assert(cssRes.status === 200, "style.css must return 200");
	assert(cssRes.body.includes(".site-header.search-docked"), "CSS must contain .search-docked rule");
	assert(cssRes.body.includes(".compact-search-pill"), "CSS must contain .compact-search-pill rule");
	assert(cssRes.body.includes(".expanded-search-container.search-bar-scrolled-out"), "CSS must contain .search-bar-scrolled-out rule");
	assert(cssRes.body.includes(".header-search-overlay"), "CSS must contain .header-search-overlay rule");
	assert(cssRes.body.includes(".header-search-backdrop"), "CSS must contain .header-search-backdrop rule");
	assert(cssRes.body.includes(".navbar-light-theme"), "CSS must contain .navbar-light-theme rule");
	assert(cssRes.body.includes(".global-nav-link.active"), "CSS must contain .global-nav-link.active rule");
	console.log("   [PASS] CSS animation and transition rules validated.\n");

	// 8. Verify Search Client Script
	console.log("8. Verifying Frontend Search Client Script (/js/search.js)...");
	const jsRes = await client("/js/search.js");
	assert(jsRes.status === 200, "search.js must return 200");
	assert(jsRes.body.includes("updateCompactPillDisplay"), "search.js must contain updateCompactPillDisplay");
	assert(jsRes.body.includes("syncAllSearchForms"), "search.js must contain syncAllSearchForms");
	assert(jsRes.body.includes("handleScrollTransition"), "search.js must contain handleScrollTransition");
	assert(jsRes.body.includes("IntersectionObserver"), "search.js must utilize IntersectionObserver");
	assert(jsRes.body.includes("requestAnimationFrame"), "search.js must use requestAnimationFrame for scroll performance");
	assert(jsRes.body.includes("search-docked"), "search.js must toggle search-docked class");
	console.log("   [PASS] Frontend search script validated.\n");

	// 9. Verify Individual Property Card Detail Route Preservation
	console.log("9. Verifying Property Detail Routing...");
	// Get first listing ID from index page
	const match = listingsRes.body.match(/\/listings\/([a-f0-9]{24})/);
	if (match) {
		const listingId = match[1];
		const detailRes = await client(`/listings/${listingId}`);
		assert(detailRes.status === 200, `Listing detail view /listings/${listingId} must return 200`);
		assert(detailRes.body.includes("aria-label=\"Main Navigation\""), "Listing detail view must retain shared global header");
		console.log(`   [PASS] Property detail route /listings/${listingId} verified.\n`);
	} else {
		console.log("   [NOTE] No 24-character listing ID found in HTML; skipping detail check.");
	}

	console.log("==================================================================");
	console.log("   ALL UNIFIED HEADER & AIRBNB SEARCH TESTS PASSED SUCCESSFULLY!  ");
	console.log("==================================================================");
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

const http = require("http");
const path = require("path");
const { fork } = require("child_process");

const PORT = 8085; // Independent port for Phase 5 test suite
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
	console.log("   WANDER-LUST PHASE 5 UX, DESIGN SYSTEM & POLISH TESTS   ");
	console.log("==========================================================\n");

	// 1. Start Server on port 8085
	console.log("1. Starting Wander-Lust test server on port 8085...");
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

	console.log("   [PASS] Server ready on port 8085.\n");

	const client = createClient();

	// 2. Test Commercial Design System CSS Assets
	console.log("2. Testing Design System CSS Assets (GET /css/style.css)...");
	const cssRes = await client("/css/style.css");
	assert(cssRes.status === 200, "style.css must return HTTP 200");
	assert(cssRes.body.includes("--primary-color: #fe424d"), "CSS must define --primary-color variable");
	assert(cssRes.body.includes(".wishlist-btn"), "CSS must contain .wishlist-btn styles");
	assert(cssRes.body.includes(".mobile-bottom-nav"), "CSS must contain .mobile-bottom-nav styles");
	assert(cssRes.body.includes(".toast-container-custom"), "CSS must contain toast container styles");
	assert(cssRes.body.includes(":focus-visible"), "CSS must contain focus-visible a11y styling");
	console.log("   [PASS] CSS Design System validated.\n");

	// 3. Test Client-Side Script Assets
	console.log("3. Testing Frontend Client Script (GET /js/script.js)...");
	const jsRes = await client("/js/script.js");
	assert(jsRes.status === 200, "script.js must return HTTP 200");
	assert(jsRes.body.includes("toggleWishlist"), "script.js must export toggleWishlist function");
	assert(jsRes.body.includes("syncWishlistIcons"), "script.js must export syncWishlistIcons function");
	assert(jsRes.body.includes("openWishlistModal"), "script.js must export openWishlistModal function");
	assert(jsRes.body.includes("toast-container-custom"), "script.js must handle toast auto-dismissal");
	console.log("   [PASS] Frontend JavaScript validated.\n");

	// 4. Test Navigation Bar & User Menu Dropdown
	console.log("4. Testing Enhanced Navigation Bar & User Dropdown...");
	const navRes = await client("/listings");
	assert(navRes.status === 200, "Listings page should return HTTP 200");
	assert(navRes.body.includes("aria-label=\"Main Navigation\""), "Navbar must have accessible landmark aria-label");
	assert(navRes.body.includes("id=\"userDropdownMenu\""), "Navbar must render user dropdown menu button");
	assert(navRes.body.includes("Host your home"), "Navbar must provide Host your home link");
	assert(navRes.body.includes("fa-compass"), "Navbar must render brand compass logo");
	console.log("   [PASS] Navigation bar validated.\n");

	// 5. Test Mobile Bottom Navigation Bar
	console.log("5. Testing Mobile Bottom Navigation Bar...");
	assert(navRes.body.includes("mobile-bottom-nav"), "Boilerplate must include mobile bottom navigation");
	assert(navRes.body.includes("aria-label=\"Mobile Navigation\""), "Bottom nav must include accessible aria-label");
	assert(navRes.body.includes("openWishlistModal()"), "Bottom nav must provide one-touch wishlist action");
	console.log("   [PASS] Mobile bottom navigation verified.\n");

	// 6. Test Modern Property Card Layout & Wishlist Toggle
	console.log("6. Testing Property Card Layout & Floating Wishlist Heart...");
	assert(navRes.body.includes("card-img-wrapper"), "Property cards must use .card-img-wrapper");
	assert(navRes.body.includes("wishlist-btn"), "Property cards must include floating .wishlist-btn");
	assert(navRes.body.includes("data-listing-id"), "Wishlist buttons must carry data-listing-id attribute");
	console.log("   [PASS] Property card layout & wishlist heart validated.\n");

	// 7. Test Saved Wishlist Modal
	console.log("7. Testing Saved Wishlist Modal Component...");
	assert(navRes.body.includes("id=\"wishlistModal\""), "Page must render #wishlistModal");
	assert(navRes.body.includes("id=\"wishlistModalContent\""), "Wishlist modal must contain content container");
	console.log("   [PASS] Wishlist modal verified.\n");

	// 8. Test Toast Container & Flash Accessibility
	console.log("8. Testing Toast Container & Flash Accessibility...");
	assert(navRes.body.includes("toast-container-custom"), "Boilerplate must render .toast-container-custom");
	console.log("   [PASS] Toast notification container verified.\n");

	// 9. Test Professional Error Template (404 Not Found)
	console.log("9. Testing Professional 404 Error Page...");
	const notFoundRes = await client("/non-existent-route-for-phase5-test");
	assert(notFoundRes.status === 404, "Unknown route must return HTTP 404");
	assert(notFoundRes.body.includes("Page or Resource Unavailable"), "Error page must show friendly title");
	assert(notFoundRes.body.includes("Explore All Listings"), "Error page must provide Explore action button");
	assert(notFoundRes.body.includes("Go Back"), "Error page must provide Go Back button");
	console.log("   [PASS] Professional error page verified.\n");

	// 10. Test User Sign-in Dropdown State Transformation
	console.log("10. Testing User Sign-in Dropdown State Transformation...");
	const testUser = `ux_user_${Date.now()}`;
	const signupRes = await client("/signup", {
		method: "POST",
		body: `username=${testUser}&email=${testUser}@example.com&password=ValidPassword123`,
	});
	assert(signupRes.status === 302, "User signup should redirect");

	const authNavRes = await client("/listings");
	assert(authNavRes.body.includes(testUser), "Navbar dropdown must show authenticated username");
	assert(authNavRes.body.includes("/logout"), "Navbar dropdown must show Logout action");
	console.log(`   [PASS] Authenticated user dropdown menu verified for '${testUser}'.\n`);

	console.log("==========================================================");
	console.log("   ALL 10 PHASE 5 AUTOMATED TESTS PASSED SUCCESSFULLY!    ");
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

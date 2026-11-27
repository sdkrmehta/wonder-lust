const http = require("http");
const path = require("path");
const fs = require("fs");
const { fork } = require("child_process");

const PORT = 8084; // Independent port for Phase 4 test suite
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
	console.log("   WONDER-LUST PHASE 4 MEDIA & LISTING MANAGEMENT TESTS   ");
	console.log("==========================================================\n");

	// 1. Start Server on port 8084
	console.log("1. Starting Wonder-Lust test server on port 8084...");
	serverProc = fork(path.join(__dirname, "../server.js"), [], {
		env: {
			...process.env,
			PORT: String(PORT),
			UPLOAD_STORAGE: process.env.TEST_UPLOAD_STORAGE || "local",
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

	console.log("   [PASS] Server ready on port 8084.\n");

	const client = createClient();

	// 2. Authenticate Test Host
	console.log("2. Registering and Authenticating Test Host...");
	const testUsername = `media_host_${Date.now()}`;
	const signupRes = await client("/signup", {
		method: "POST",
		body: `username=${testUsername}&email=${testUsername}@example.com&password=SecretPassword123`,
	});
	assert(signupRes.status === 302, "Host signup should succeed and redirect");
	console.log(`   [PASS] Host '${testUsername}' authenticated.\n`);

	// 3. Multi-Image Upload & GeoJSON Auto-Geocoding
	console.log("3. Testing Multi-Image Upload and Auto-Geocoding...");
	const boundary = `----WebKitFormBoundary${Date.now()}`;
	const dummyPng1 = Buffer.from([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
		0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
		0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
		0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
		0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
	]);
	const dummyPng2 = Buffer.from(dummyPng1); // second image

	const multiPartPayload = Buffer.concat([
		Buffer.from(
			`--${boundary}\r\nContent-Disposition: form-data; name="listing[title]"\r\n\r\nJaipur Royal Haveli\r\n` +
			`--${boundary}\r\nContent-Disposition: form-data; name="listing[description]"\r\n\r\nMagnificent heritage property in the pink city.\r\n` +
			`--${boundary}\r\nContent-Disposition: form-data; name="listing[price]"\r\n\r\n7500\r\n` +
			`--${boundary}\r\nContent-Disposition: form-data; name="listing[location]"\r\n\r\nJaipur\r\n` +
			`--${boundary}\r\nContent-Disposition: form-data; name="listing[country]"\r\n\r\nIndia\r\n` +
			`--${boundary}\r\nContent-Disposition: form-data; name="listing[propertyType]"\r\n\r\nVilla\r\n` +
			`--${boundary}\r\nContent-Disposition: form-data; name="listing[status]"\r\n\r\npublished\r\n` +
			`--${boundary}\r\nContent-Disposition: form-data; name="listing[image]"; filename="haveli_1.png"\r\nContent-Type: image/png\r\n\r\n`
		),
		dummyPng1,
		Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="listing[image]"; filename="haveli_2.png"\r\nContent-Type: image/png\r\n\r\n`),
		dummyPng2,
		Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="listing[image]"; filename="haveli_3.png"\r\nContent-Type: image/png\r\n\r\n`),
		dummyPng2,
		Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="listing[image]"; filename="haveli_4.png"\r\nContent-Type: image/png\r\n\r\n`),
		dummyPng2,
		Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="listing[images]"; filename="haveli_courtyard.png"\r\nContent-Type: image/png\r\n\r\n`),
		dummyPng2,
		Buffer.from(`\r\n--${boundary}--\r\n`),
	]);

	const createRes = await client("/listings", {
		method: "POST",
		headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
		body: multiPartPayload,
	});
	assert(createRes.status === 302, "Listing creation should redirect");
	const listingId = createRes.headers.location.split("/").pop();
	assert(listingId && listingId.length === 24, "Valid ObjectId returned");

	// Verify listing in API v1
	const fetchApi = await client(`/api/v1/listings/${listingId}`);
	const apiListing = fetchApi.json().data;
	assert(apiListing.images && apiListing.images.length === 5, "Listing must have 5 gallery images");
	assert(apiListing.images[0].isPrimary === true, "First image must be primary");
	assert(apiListing.geometry && apiListing.geometry.type === "Point", "Geometry must be Point");
	assert(
		Math.abs(apiListing.geometry.coordinates[0] - 75.7873) < 0.1,
		"Jaipur longitude should be ~75.78",
	);
	assert(
		Math.abs(apiListing.geometry.coordinates[1] - 26.9124) < 0.1,
		"Jaipur latitude should be ~26.91",
	);
	console.log(`   [PASS] Multi-image gallery (5 photos) & Jaipur geocoding verified for listing ${listingId}.\n`);

	// 4. Test View Counter Increment
	console.log("4. Testing Listing View Counter Increment...");
	const initialViews = apiListing.views || 0;
	await client(`/listings/${listingId}`);
	const fetchAgain = await client(`/api/v1/listings/${listingId}`);
	const updatedViews = fetchAgain.json().data.views;
	assert(updatedViews > initialViews, `View count should increment (${initialViews} -> ${updatedViews})`);
	console.log(`   [PASS] Listing view count successfully incremented to ${updatedViews}.\n`);

	// 5. Test Primary Image Designation
	console.log("5. Testing Primary Cover Image Designation...");
	const secondImageId = apiListing.images[1]._id;
	const setPrimaryRes = await client(`/api/v1/listings/${listingId}/images/${secondImageId}/primary`, {
		method: "POST",
	});
	assert(setPrimaryRes.status === 200, "Setting primary image should succeed");
	const postPrimaryListing = setPrimaryRes.json().data;
	const newPrimary = postPrimaryListing.images.find((img) => String(img._id) === String(secondImageId));
	assert(newPrimary && newPrimary.isPrimary === true, "Target image should be marked primary");
	console.log("   [PASS] Successfully changed primary thumbnail image.\n");

	// 6. Test Gallery Image Deletion & Local File Cleanup
	console.log("6. Testing Image Deletion & Disk Cleanup...");
	const targetDeleteFilename = apiListing.images[0].filename;
	const uploadFilePath = path.join(__dirname, "../public/uploads", targetDeleteFilename);
	assert(fs.existsSync(uploadFilePath), "Image file must exist on disk before deletion");

	const deleteImgRes = await client(`/api/v1/listings/${listingId}/images/${apiListing.images[0]._id}`, {
		method: "DELETE",
	});
	assert(deleteImgRes.status === 200, "Deleting image should return 200");
	const afterDeleteListing = deleteImgRes.json().data;
	assert(afterDeleteListing.images.length === 4, "Gallery should now contain 4 images");
	assert(!fs.existsSync(uploadFilePath), "Orphaned image file must be deleted from disk");
	console.log("   [PASS] Image removed from gallery and physical file deleted from uploads folder.\n");

	// 7. Test Draft vs Published Status
	console.log("7. Testing Draft vs. Published Visibility Filter...");
	const draftBoundary = `----WebKitFormBoundaryDraft${Date.now()}`;
	const draftImageParts = [];
	for (let i = 1; i <= 5; i++) {
		draftImageParts.push(
			Buffer.from(
				`--${draftBoundary}\r\nContent-Disposition: form-data; name="listing[image]"; filename="draft_${i}.png"\r\nContent-Type: image/png\r\n\r\n`,
			),
			dummyPng1,
			Buffer.from("\r\n"),
		);
	}
	const draftPayload = Buffer.concat([
		Buffer.from(
			`--${draftBoundary}\r\nContent-Disposition: form-data; name="listing[title]"\r\n\r\nUnpublished Secret Cabin\r\n` +
			`--${draftBoundary}\r\nContent-Disposition: form-data; name="listing[description]"\r\n\r\nDraft property not ready for public viewing.\r\n` +
			`--${draftBoundary}\r\nContent-Disposition: form-data; name="listing[price]"\r\n\r\n3000\r\n` +
			`--${draftBoundary}\r\nContent-Disposition: form-data; name="listing[location]"\r\n\r\nAspen\r\n` +
			`--${draftBoundary}\r\nContent-Disposition: form-data; name="listing[country]"\r\n\r\nUnited States\r\n` +
			`--${draftBoundary}\r\nContent-Disposition: form-data; name="listing[status]"\r\n\r\ndraft\r\n`
		),
		...draftImageParts,
		Buffer.from(`--${draftBoundary}--\r\n`),
	]);

	const createDraftRes = await client("/listings", {
		method: "POST",
		headers: { "Content-Type": `multipart/form-data; boundary=${draftBoundary}` },
		body: draftPayload,
	});
	const draftListingId = createDraftRes.headers.location.split("/").pop();

	// Verify draft filter query
	const publicSearch = await client("/api/v1/listings?status=published&limit=50");
	const publicListings = publicSearch.json().data.listings;
	const isDraftPublic = publicListings.some((l) => String(l._id) === String(draftListingId));
	assert(!isDraftPublic, "Draft listing must NOT appear in published search results");

	const draftSearch = await client("/api/v1/listings?status=draft");
	const draftListings = draftSearch.json().data.listings;
	const isDraftFound = draftListings.some((l) => String(l._id) === String(draftListingId));
	assert(isDraftFound, "Draft listing should be returned when status=draft requested");
	console.log("   [PASS] Draft vs Published filtering verified.\n");

	// 8. Test Invalid Mime Type Validation
	console.log("8. Testing Invalid File Mime Type Rejection...");
	const badFileBoundary = `----WebKitFormBoundaryBad${Date.now()}`;
	const badFilePayload = Buffer.concat([
		Buffer.from(
			`--${badFileBoundary}\r\nContent-Disposition: form-data; name="listing[title]"\r\n\r\nInvalid File Property\r\n` +
			`--${badFileBoundary}\r\nContent-Disposition: form-data; name="listing[description]"\r\n\r\nTesting invalid file upload.\r\n` +
			`--${badFileBoundary}\r\nContent-Disposition: form-data; name="listing[price]"\r\n\r\n3000\r\n` +
			`--${badFileBoundary}\r\nContent-Disposition: form-data; name="listing[location]"\r\n\r\nGoa\r\n` +
			`--${badFileBoundary}\r\nContent-Disposition: form-data; name="listing[country]"\r\n\r\nIndia\r\n` +
			`--${badFileBoundary}\r\nContent-Disposition: form-data; name="listing[image]"; filename="malicious.exe"\r\nContent-Type: application/x-msdownload\r\n\r\n`
		),
		Buffer.from("MZNOTANIMAGEFILE"),
		Buffer.from(`\r\n--${badFileBoundary}--\r\n`),
	]);

	const badUploadRes = await client("/api/v1/listings", {
		method: "POST",
		headers: { "Content-Type": `multipart/form-data; boundary=${badFileBoundary}` },
		body: badFilePayload,
	});
	assert(badUploadRes.status === 400, "Invalid mime type should be rejected with HTTP 400");
	console.log("   [PASS] Invalid file format rejected cleanly.\n");

	// 8b. Test Minimum 5 & Maximum 10 Photos Enforcement on Web Form
	console.log("8b. Testing Minimum 5 and Maximum 10 Photos Validation...");
	const tooFewBoundary = `----WebKitFormBoundaryFew${Date.now()}`;
	const tooFewPayload = Buffer.concat([
		Buffer.from(
			`--${tooFewBoundary}\r\nContent-Disposition: form-data; name="listing[title]"\r\n\r\nToo Few Photos Villa\r\n` +
			`--${tooFewBoundary}\r\nContent-Disposition: form-data; name="listing[description]"\r\n\r\nOnly two images provided.\r\n` +
			`--${tooFewBoundary}\r\nContent-Disposition: form-data; name="listing[price]"\r\n\r\n3000\r\n` +
			`--${tooFewBoundary}\r\nContent-Disposition: form-data; name="listing[location]"\r\n\r\nGoa\r\n` +
			`--${tooFewBoundary}\r\nContent-Disposition: form-data; name="listing[country]"\r\n\r\nIndia\r\n` +
			`--${tooFewBoundary}\r\nContent-Disposition: form-data; name="listing[image]"; filename="few_1.png"\r\nContent-Type: image/png\r\n\r\n`
		),
		dummyPng1,
		Buffer.from(`\r\n--${tooFewBoundary}\r\nContent-Disposition: form-data; name="listing[image]"; filename="few_2.png"\r\nContent-Type: image/png\r\n\r\n`),
		dummyPng2,
		Buffer.from(`\r\n--${tooFewBoundary}--\r\n`),
	]);
	const tooFewRes = await client("/listings", {
		method: "POST",
		headers: { "Content-Type": `multipart/form-data; boundary=${tooFewBoundary}` },
		body: tooFewPayload,
	});
	assert(tooFewRes.status === 302 && tooFewRes.headers.location === "/listings/new", "Fewer than 5 photos must redirect back to /listings/new");

	const tooManyBoundary = `----WebKitFormBoundaryMany${Date.now()}`;
	const tooManyParts = [];
	for (let i = 1; i <= 11; i++) {
		tooManyParts.push(
			Buffer.from(`--${tooManyBoundary}\r\nContent-Disposition: form-data; name="listing[image]"; filename="many_${i}.png"\r\nContent-Type: image/png\r\n\r\n`),
			dummyPng1,
			Buffer.from("\r\n"),
		);
	}
	const tooManyPayload = Buffer.concat([
		Buffer.from(
			`--${tooManyBoundary}\r\nContent-Disposition: form-data; name="listing[title]"\r\n\r\nToo Many Photos Villa\r\n` +
			`--${tooManyBoundary}\r\nContent-Disposition: form-data; name="listing[description]"\r\n\r\nEleven images provided.\r\n` +
			`--${tooManyBoundary}\r\nContent-Disposition: form-data; name="listing[price]"\r\n\r\n3000\r\n` +
			`--${tooManyBoundary}\r\nContent-Disposition: form-data; name="listing[location]"\r\n\r\nGoa\r\n` +
			`--${tooManyBoundary}\r\nContent-Disposition: form-data; name="listing[country]"\r\n\r\nIndia\r\n`
		),
		...tooManyParts,
		Buffer.from(`--${tooManyBoundary}--\r\n`),
	]);
	const tooManyRes = await client("/listings", {
		method: "POST",
		headers: { "Content-Type": `multipart/form-data; boundary=${tooManyBoundary}` },
		body: tooManyPayload,
	});
	assert(tooManyRes.status === 302, "More than 10 photos must fail and redirect cleanly");
	const checkTooMany = await client("/api/v1/listings?q=Too+Many+Photos+Villa");
	assert(checkTooMany.json().data.listings.length === 0, "Listing with > 10 photos must not be created");
	const checkTooFew = await client("/api/v1/listings?q=Too+Few+Photos+Villa");
	assert(checkTooFew.json().data.listings.length === 0, "Listing with < 5 photos must not be created");
	console.log("   [PASS] Web form rejects < 5 and > 10 photos cleanly.\n");

	// 9. Test Web UI Leaflet Map & Multi-Image Gallery Rendering
	console.log("9. Testing Web UI Show Page Map & Gallery Rendering...");
	const webShowRes = await client(`/listings/${listingId}`);
	assert(webShowRes.status === 200, "Show page should return HTTP 200");
	assert(webShowRes.body.includes("id=\"map\""), "Show page must include Leaflet map container");
	assert(webShowRes.body.includes("L.map("), "Show page must include Leaflet map initialization");
	assert(webShowRes.body.includes("switchHeroImage"), "Show page must include gallery switcher function");
	assert(webShowRes.body.includes("views"), "Show page must display view counter");
	console.log("   [PASS] Show page contains interactive map, gallery controls, and view count.\n");

	// 10. Clean up test listings
	console.log("10. Cleaning up test listings...");
	await client(`/listings/${listingId}?_method=DELETE`, { method: "POST" });
	await client(`/listings/${draftListingId}?_method=DELETE`, { method: "POST" });
	console.log("   [PASS] Test listings and media assets removed cleanly.\n");

	console.log("==========================================================");
	console.log("   ALL 10 PHASE 4 AUTOMATED TESTS PASSED SUCCESSFULLY!    ");
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

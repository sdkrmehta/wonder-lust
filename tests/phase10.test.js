const http = require("http");
const path = require("path");
const { fork } = require("child_process");

const PORT = 8090; // Dedicated port for Phase 10 test suite
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
	console.log("   WONDER-LUST PHASE 10 MESSAGING & CHAT TEST SUITE       ");
	console.log("==========================================================\n");

	// 1. Start Server on port 8090
	console.log("1. Starting Wonder-Lust test server on port 8090...");
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

	console.log("   [PASS] Server ready on port 8090.\n");

	// 2. Setup Host, Guest 1, and Guest 2 User Accounts
	console.log("2. Setting up Host and Guest accounts...");
	const hostClient = createClient();
	const guestClient1 = createClient();
	const guestClient2 = createClient();
	const anonClient = createClient();

	const hostName = `chat_host_${Date.now()}`;
	const guest1Name = `traveler_msg1_${Date.now()}`;
	const guest2Name = `traveler_msg2_${Date.now()}`;

	await hostClient("/signup", {
		method: "POST",
		body: `username=${hostName}&email=${hostName}@example.com&password=Password123`,
	});

	await guestClient1("/signup", {
		method: "POST",
		body: `username=${guest1Name}&email=${guest1Name}@example.com&password=Password123`,
	});

	await guestClient2("/signup", {
		method: "POST",
		body: `username=${guest2Name}&email=${guest2Name}@example.com&password=Password123`,
	});

	console.log("   [PASS] Host and 2 Guest travelers authenticated.\n");

	// 3. Host creates Property Listing
	console.log("3. Host creating property listing...");
	const createListingRes = await hostClient("/api/v1/listings", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			listing: {
				title: "Kochi Backwaters Luxury Houseboat",
				description: "Private cruise through tranquil Kerala canals with traditional chef.",
				price: 8500,
				location: "Kochi",
				country: "India",
				category: "Boats",
				propertyType: "Other",
				guests: 6,
			},
		}),
	});
	assert(createListingRes.status === 201, "Host must be able to create property");
	const testListing = createListingRes.json().data;
	const listingId = testListing._id;
	console.log(`   [PASS] Created property '${testListing.title}' with ID: ${listingId}.\n`);

	// 4. Guard: Host cannot message themselves about their own listing
	console.log("4. Testing Self-Messaging Prevention Guard...");
	const selfMsgRes = await hostClient("/api/v1/conversations/inquiry", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			listingId: listingId,
			message: "Can I book my own boat?",
		}),
	});
	assert(selfMsgRes.status === 400, "Inquiring about own property must be rejected with HTTP 400");
	console.log("   [PASS] Self-messaging prevented.\n");

	// 5. Guest 1 sends inquiry to Host
	console.log("5. Guest 1 sending property inquiry to Host...");
	const inquiryRes = await guestClient1("/api/v1/conversations/inquiry", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			listingId: listingId,
			message: "Hello! Does the houseboat cruise operate during evening sunset hours?",
		}),
	});
	assert(inquiryRes.status === 201, "Inquiry creation should return HTTP 201");
	const conversation = inquiryRes.json().data;
	const conversationId = conversation._id;
	console.log(`   [PASS] Conversation created with ID: ${conversationId}.\n`);

	// 6. Host checks Unread Message Count
	console.log("6. Testing Host Unread Message Count...");
	const hostUnreadRes1 = await hostClient("/api/v1/conversations/unread-count");
	assert(hostUnreadRes1.status === 200, "Unread count API should return 200");
	assert(hostUnreadRes1.json().data.unreadCount === 1, "Host should have 1 unread message");
	console.log("   [PASS] Host has 1 unread message notification.\n");

	// 7. Host retrieves Conversation Messages (Marks as read)
	console.log("7. Host opening Conversation (Marking messages as read)...");
	const hostMessagesRes = await hostClient(`/api/v1/conversations/${conversationId}/messages`);
	assert(hostMessagesRes.status === 200, "Fetching messages should return 200");
	const threadData = hostMessagesRes.json().data;
	assert(threadData.messages.length === 1, "Should contain 1 inquiry message");
	assert(threadData.messages[0].body.includes("sunset hours"), "Message body should match inquiry");
	console.log("   [PASS] Host retrieved messages and read receipts triggered.\n");

	// 8. Verify Host Unread Counter has been reset to 0
	console.log("8. Verifying Host Unread Counter reset...");
	const hostUnreadRes2 = await hostClient("/api/v1/conversations/unread-count");
	assert(hostUnreadRes2.json().data.unreadCount === 0, "Host unread count should now be 0");
	console.log("   [PASS] Host unread count reset to 0.\n");

	// 9. Host replies to Guest 1
	console.log("9. Host sending reply to Guest 1...");
	const replyRes = await hostClient(`/api/v1/conversations/${conversationId}/messages`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			body: "Yes! Our sunset cruise runs from 5:00 PM to 7:00 PM with traditional refreshments.",
		}),
	});
	assert(replyRes.status === 201, "Sending message should return HTTP 201");
	const replyMsg = replyRes.json().data;
	assert(replyMsg.body.includes("5:00 PM to 7:00 PM"), "Reply body should match");

	// Guest 1 should now have 1 unread message
	const guestUnreadRes = await guestClient1("/api/v1/conversations/unread-count");
	assert(guestUnreadRes.json().data.unreadCount === 1, "Guest 1 should now have 1 unread message");
	console.log("   [PASS] Host reply delivered and Guest 1 notified.\n");

	// 10. Security: Guest 2 cannot access or post in Guest 1's conversation
	console.log("10. Testing Conversation Access Control (Guest 2 attempting access)...");
	const unauthorizedReadRes = await guestClient2(`/api/v1/conversations/${conversationId}/messages`);
	assert(unauthorizedReadRes.status === 403, "Third party viewing conversation must return HTTP 403");

	const unauthorizedPostRes = await guestClient2(`/api/v1/conversations/${conversationId}/messages`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			body: "Intruder attempting to inject message.",
		}),
	});
	assert(unauthorizedPostRes.status === 403, "Third party posting to conversation must return HTTP 403");
	console.log("   [PASS] Conversation privacy and access control enforced.\n");

	// 11. Web UI Inbox View (GET /messages)
	console.log("11. Testing Web UI Inbox View (GET /messages)...");
	const inboxHtmlRes = await guestClient1("/messages");
	assert(inboxHtmlRes.status === 200, "Inbox page should return HTTP 200");
	assert(inboxHtmlRes.body.includes("Messages"), "Inbox must show Messages header");
	assert(inboxHtmlRes.body.includes("Kochi Backwaters Luxury Houseboat"), "Inbox must show property title");
	assert(inboxHtmlRes.body.includes(hostName), "Inbox must show host name");
	console.log("   [PASS] Web UI Inbox view verified.\n");

	// 12. Web UI Conversation View (GET /messages/:id)
	console.log("12. Testing Web UI Conversation Thread (GET /messages/:conversationId)...");
	const threadHtmlRes = await hostClient(`/messages/${conversationId}`);
	assert(threadHtmlRes.status === 200, "Conversation thread page must return HTTP 200");
	assert(threadHtmlRes.body.includes("sunset hours"), "Thread must render guest message");
	assert(threadHtmlRes.body.includes("5:00 PM to 7:00 PM"), "Thread must render host reply");
	assert(threadHtmlRes.body.includes("chatComposerForm"), "Thread must render message composer form");
	console.log("   [PASS] Web UI Conversation thread verified.\n");

	// 13. Web UI Listing Show Page Contact Host Modal Rendering
	console.log("13. Testing Listing Show Page Contact Host Modal...");
	const showPageRes = await guestClient1(`/listings/${listingId}`);
	assert(showPageRes.status === 200, "Show page should return HTTP 200");
	assert(showPageRes.body.includes("Contact Host"), "Show page must include Contact Host button");
	assert(showPageRes.body.includes("contactHostModal"), "Show page must include contactHostModal");
	console.log("   [PASS] Contact Host action verified on show page.\n");

	// 14. Unauthenticated Access Control
	console.log("14. Testing Unauthenticated Access Guards...");
	const anonInboxRes = await anonClient("/messages");
	assert(anonInboxRes.status === 302 && anonInboxRes.headers.location === "/login", "Unauthenticated /messages must redirect to /login");

	const anonApiRes = await anonClient("/api/v1/conversations");
	assert(anonApiRes.status === 302 || anonApiRes.status === 401, "Unauthenticated API request must be rejected");
	console.log("   [PASS] Access control verified.\n");

	// 15. Clean teardown of test listing & data
	console.log("15. Cleaning up test listing & data...");
	await hostClient(`/listings/${listingId}?_method=DELETE`, { method: "POST" });
	console.log("   [PASS] Cleaned up test property.\n");

	console.log("==========================================================");
	console.log("   ALL 15 PHASE 10 AUTOMATED TESTS PASSED SUCCESSFULLY!   ");
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

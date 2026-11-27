const http = require("http");
const path = require("path");
const { fork } = require("child_process");

const PORT = 8091; // Dedicated port for Phase 11 test suite
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
	console.log("   WONDER-LUST PHASE 11 NOTIFICATIONS & ALERTS TESTS      ");
	console.log("==========================================================\n");

	// 1. Spawning Wonder-Lust server on port 8091
	console.log(`1. Starting Wonder-Lust test server on port ${PORT}...`);
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

	const hostClient = createClient();
	const guestClient1 = createClient();
	const guestClient2 = createClient();
	const anonClient = createClient();

	const timestamp = Date.now();
	const hostUser = {
		username: `host_p11_${timestamp}`,
		email: `host_p11_${timestamp}@example.com`,
		password: "Password123!",
	};
	const guestUser1 = {
		username: `guest1_p11_${timestamp}`,
		email: `guest1_p11_${timestamp}@example.com`,
		password: "Password123!",
	};
	const guestUser2 = {
		username: `guest2_p11_${timestamp}`,
		email: `guest2_p11_${timestamp}@example.com`,
		password: "Password123!",
	};

	// 2. Setting up accounts
	console.log("2. Setting up Host and Guest traveler accounts...");
	let res = await hostClient("/signup", {
		method: "POST",
		body: `username=${hostUser.username}&email=${hostUser.email}&password=${hostUser.password}`,
	});
	assert(res.status === 302, "Host signup must succeed");

	res = await guestClient1("/signup", {
		method: "POST",
		body: `username=${guestUser1.username}&email=${guestUser1.email}&password=${guestUser1.password}`,
	});
	assert(res.status === 302, "Guest 1 signup must succeed");

	res = await guestClient2("/signup", {
		method: "POST",
		body: `username=${guestUser2.username}&email=${guestUser2.email}&password=${guestUser2.password}`,
	});
	assert(res.status === 302, "Guest 2 signup must succeed");
	console.log("   [PASS] Host and Guest travelers authenticated.\n");

	// 3. Creating Test Property Listing as Host
	console.log("3. Host creating property listing...");
	const createListingRes = await hostClient("/api/v1/listings", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			listing: {
				title: "Manali Pine Forest Chalet",
				description: "Serene wooden chalet nestled among high pines.",
				price: 4200,
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

	// 4. Testing Initial Unread Count for Host & Guest
	console.log("4. Testing initial unread notification count via API...");
	let apiRes = await hostClient("/api/v1/notifications/unread-count");
	assert(apiRes.status === 200, "Unread count API must return 200");
	assert(apiRes.json().data.unreadCount === 0, "Initial unread count must be 0");
	console.log("   [PASS] Initial unread count is 0.\n");

	// 5. Booking Event: Guest 1 reserves property -> Host receives notification
	console.log("5. Testing Booking Event Notification dispatch to Host...");
	const bookRes = await guestClient1(`/api/v1/listings/${listingId}/bookings`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			booking: {
				checkIn: "2026-12-10",
				checkOut: "2026-12-13",
				guests: 2,
			},
		}),
	});
	assert(bookRes.status === 201, "Booking creation must succeed with HTTP 201");
	const booking = bookRes.json().data;
	const bookingId = booking._id;

	// Check Host's notifications
	apiRes = await hostClient("/api/v1/notifications");
	assert(apiRes.status === 200, "Host notifications list must return 200");
	let hostNotifications = apiRes.json().data.notifications;
	assert(hostNotifications.length > 0, "Host must have received at least 1 notification");
	const bookingNotif = hostNotifications.find((n) => n.type === "booking_confirmed");
	assert(bookingNotif, "Host must receive a 'booking_confirmed' notification");
	assert(bookingNotif.title.includes("Reservation Confirmed"), "Notification title must reflect confirmed reservation");
	assert(bookingNotif.message.includes("Manali Pine Forest Chalet"), "Notification message must mention listing title");
	console.log("   [PASS] Host received 'booking_confirmed' notification.\n");

	// 6. Payment Event: Guest 1 pays for booking -> Guest & Host receive notifications
	console.log("6. Testing Payment Event Notification dispatch...");
	const payRes = await guestClient1("/api/v1/payments/create-order", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			bookingId: bookingId,
			amount: booking.totalPrice,
			paymentMethod: "card",
			cardNumber: "4111222233334242",
			cardExpiry: "12/28",
			cardCvc: "123",
			cardHolderName: "Traveler Guest",
			billingDetails: {
				fullName: "Traveler Guest",
				email: "traveler@example.com",
				phone: "+91 9876543210",
				address: "123 Mall Road",
				city: "Manali",
				state: "Himachal Pradesh",
				postalCode: "175131",
			},
		}),
	});
	assert(payRes.status === 201, "Payment must succeed with HTTP 201");

	// Verify Guest 1 notification
	apiRes = await guestClient1("/api/v1/notifications");
	const guestNotifications = apiRes.json().data.notifications;
	const paymentNotif = guestNotifications.find((n) => n.type === "payment_succeeded");
	assert(paymentNotif, "Guest must receive 'payment_succeeded' notification");
	assert(paymentNotif.link.includes("/payments/receipt/"), "Payment notification link must point to invoice receipt");

	// Verify Host notification
	apiRes = await hostClient("/api/v1/notifications");
	hostNotifications = apiRes.json().data.notifications;
	const hostPaymentNotif = hostNotifications.find((n) => n.type === "payment_succeeded");
	assert(hostPaymentNotif, "Host must receive 'payment_succeeded' notification");
	console.log("   [PASS] Guest and Host received 'payment_succeeded' notifications.\n");

	// 7. Messaging Event: Guest 1 sends message to Host -> Host receives notification
	console.log("7. Testing Message Event Notification dispatch...");
	const inquiryRes = await guestClient1("/api/v1/conversations/inquiry", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			listingId: listingId,
			message: "Hi! Is bonfire and outdoor heating available in winter?",
		}),
	});
	assert(inquiryRes.status === 201, "Inquiry submission must succeed");

	apiRes = await hostClient("/api/v1/notifications");
	hostNotifications = apiRes.json().data.notifications;
	const messageNotif = hostNotifications.find((n) => n.type === "new_message");
	assert(messageNotif, "Host must receive 'new_message' notification");
	assert(messageNotif.message.includes("bonfire"), "Notification preview must include message content snippet");
	assert(messageNotif.link.includes("/messages/"), "Notification link must route to chat conversation");
	console.log("   [PASS] Host received 'new_message' notification with chat thread link.\n");

	// 8. Review Event: Guest 1 reviews property -> Host receives notification
	console.log("8. Testing Review Event Notification dispatch...");
	const revRes = await guestClient1(`/api/v1/listings/${listingId}/reviews`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			review: {
				rating: 5,
				comment: "Absolutely breathtaking pine retreat! Quiet and pristine.",
				cleanliness: 5,
				accuracy: 5,
				communication: 5,
				location: 5,
				checkIn: 5,
				value: 5,
			},
		}),
	});
	assert(revRes.status === 201, "Review creation must succeed with HTTP 201");
	const reviewId = revRes.json().data._id;

	apiRes = await hostClient("/api/v1/notifications");
	hostNotifications = apiRes.json().data.notifications;
	const reviewNotif = hostNotifications.find((n) => n.type === "new_review");
	assert(reviewNotif, "Host must receive 'new_review' notification");
	assert(reviewNotif.title.includes("5★ Review"), "Review notification must highlight star rating");
	assert(reviewNotif.message.includes("breathtaking pine retreat"), "Review notification must quote comment snippet");
	console.log("   [PASS] Host received 'new_review' notification.\n");

	// 9. Host Reply Event: Host replies to review -> Guest 1 receives notification
	console.log("9. Testing Host Reply Notification dispatch to Guest...");
	const replyRes = await hostClient(`/api/v1/listings/${listingId}/reviews/${reviewId}/reply`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			comment: "Thank you so much! It was a pleasure hosting you.",
		}),
	});
	assert(replyRes.status === 200, "Host reply must succeed with HTTP 200");

	apiRes = await guestClient1("/api/v1/notifications");
	const guestNotifsAfterReply = apiRes.json().data.notifications;
	const replyNotif = guestNotifsAfterReply.find((n) => n.type === "host_reply");
	assert(replyNotif, "Guest must receive 'host_reply' notification");
	assert(replyNotif.message.includes("pleasure hosting you"), "Reply notification must quote host response");
	console.log("   [PASS] Guest received 'host_reply' notification.\n");

	// 10. Cancellation & Refund Event: Guest 1 cancels booking -> Notifications dispatched
	console.log("10. Testing Booking Cancellation & Refund Notifications...");
	const cancelRes = await guestClient1(`/api/v1/bookings/${bookingId}/cancel`, {
		method: "PATCH",
	});
	assert(cancelRes.status === 200, "Cancellation must succeed with HTTP 200");

	// Host gets cancellation notice
	apiRes = await hostClient("/api/v1/notifications");
	hostNotifications = apiRes.json().data.notifications;
	const cancelNotif = hostNotifications.find((n) => n.type === "booking_cancelled");
	assert(cancelNotif, "Host must receive 'booking_cancelled' notification");

	// Guest gets refund notice
	apiRes = await guestClient1("/api/v1/notifications");
	const guestRefundNotif = apiRes.json().data.notifications.find((n) => n.type === "payment_refunded");
	assert(guestRefundNotif, "Guest must receive 'payment_refunded' notification");
	assert(guestRefundNotif.title.includes("Refund"), "Notification title must specify refund");
	console.log("   [PASS] Cancellation and refund notifications dispatched successfully.\n");

	// 11. Web UI Notification Center (GET /notifications)
	console.log("11. Testing Web UI Notification Center rendering (GET /notifications)...");
	const notifHtmlRes = await hostClient("/notifications");
	assert(notifHtmlRes.status === 200, "Notification page must return HTTP 200");
	assert(notifHtmlRes.body.includes("Notification Center"), "Must render Notification Center header");
	assert(notifHtmlRes.body.includes("Unread Only"), "Must render Unread filter tab");
	console.log("   [PASS] Web UI Notification Center rendered cleanly.\n");

	// 12. Mark Single Notification as Read (POST /notifications/:id/read)
	console.log("12. Testing Mark Single Notification as Read via Web UI / AJAX...");
	const targetNotifId = hostNotifications[0]._id;
	const readRes = await hostClient(`/notifications/${targetNotifId}/read`, {
		method: "POST",
		headers: { Accept: "application/json" },
	});
	assert(readRes.status === 200, "Mark as read AJAX must return HTTP 200");
	assert(readRes.json().data.isRead === true, "Notification isRead must be true");
	assert(readRes.json().data.readAt !== null, "Notification readAt must be populated");
	console.log("   [PASS] Single notification marked as read.\n");

	// 13. REST API v1 Notifications List & Pagination
	console.log("13. Testing REST API v1 Notifications List (GET /api/v1/notifications)...");
	apiRes = await hostClient("/api/v1/notifications?limit=5");
	assert(apiRes.status === 200, "API v1 notifications must return HTTP 200");
	assert(apiRes.json().data.notifications.length <= 5, "Pagination limit must be respected");
	assert(typeof apiRes.json().data.total === "number", "Total count must be returned");
	assert(typeof apiRes.json().data.unreadCount === "number", "Unread count must be returned");
	console.log("   [PASS] API v1 pagination and metadata verified.\n");

	// 14. REST API v1 Mark All Read (POST /api/v1/notifications/mark-all-read)
	console.log("14. Testing REST API v1 Mark All Read...");
	const markAllRes = await hostClient("/api/v1/notifications/mark-all-read", {
		method: "POST",
	});
	assert(markAllRes.status === 200, "Mark all as read must return HTTP 200");
	assert(typeof markAllRes.json().data.modifiedCount === "number", "Must return count of modified notifications");

	// Verify unread count is now 0
	apiRes = await hostClient("/api/v1/notifications/unread-count");
	assert(apiRes.json().data.unreadCount === 0, "Unread count must now be 0");
	console.log("   [PASS] All notifications marked as read; unread count is 0.\n");

	// 15. Access Control Security: Guest 2 cannot view or modify Host's notifications
	console.log("15. Testing Access Control & Security Boundaries...");
	const unauthorizedReadRes = await guestClient2(`/notifications/${targetNotifId}/read`, {
		method: "POST",
		headers: { Accept: "application/json" },
	});
	assert(
		unauthorizedReadRes.status === 404,
		"Guest 2 must not be able to mark Host's notification as read (HTTP 404)",
	);

	const anonAccessRes = await anonClient("/notifications");
	assert(
		anonAccessRes.status === 302 && anonAccessRes.headers.location === "/login",
		"Unauthenticated access must redirect to /login",
	);
	console.log("   [PASS] Access control and data isolation strictly enforced.\n");

	// 16. Clean teardown of test listing
	console.log("16. Cleaning up test listing and related records...");
	await hostClient(`/listings/${listingId}?_method=DELETE`, { method: "POST" });
	console.log("   [PASS] Cleaned up test property.\n");

	console.log("==========================================================");
	console.log("   ALL 16 PHASE 11 AUTOMATED TESTS PASSED SUCCESSFULLY!   ");
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

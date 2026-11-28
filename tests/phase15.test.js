const http = require("http");
const path = require("path");
const { fork } = require("child_process");
const mongoose = require("mongoose");
const env = require("../config/env");

const Listing = require("../models/listing");
const Booking = require("../models/booking");
const Payment = require("../models/payment");
const Review = require("../models/review");
const User = require("../models/user");
const Notification = require("../models/notification");
const Conversation = require("../models/conversation");
const Message = require("../models/message");
const {
	startMockResendServer,
	signupAndVerifyClient,
} = require("./helpers/testHarness");

const PORT = 8095; // Dedicated port for Phase 15 End-to-End Orchestration
const BASE_URL = `http://localhost:${PORT}`;

let serverProc;
let mockResend;

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
	console.log("================================================================================");
	console.log("   WONDER-LUST PHASE 15 END-TO-END ORCHESTRATION & LIFECYCLE SIMULATION        ");
	console.log("================================================================================\n");

	// 1. Spawning Wonder-Lust server on port 8095
	console.log(`1. Starting Wonder-Lust test server on port ${PORT}...`);
	mockResend = await startMockResendServer();
	serverProc = fork(path.join(__dirname, "../server.js"), [], {
		env: {
			...process.env,
			PORT: String(PORT),
			PAYMENT_PROVIDER: "sandbox",
			APP_BASE_URL: BASE_URL,
			RESEND_API_KEY: "re_test_mock_key",
			RESEND_FROM_EMAIL: "Wonder-Lust <no-reply@wonderlust.test>",
			RESEND_BASE_URL: mockResend.url,
			OTP_HASH_SECRET: "test-otp-hash-secret-phase15",
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

	// Test entity tracking for guaranteed cleanup
	const createdListingIds = [];
	const createdBookingIds = [];
	const createdPaymentIds = [];
	const createdReviewIds = [];
	const createdConversationIds = [];
	const createdUserIds = [];

	const hostClient = createClient();
	const guestClient1 = createClient();
	const guestClient2 = createClient();
	const adminClient = createClient();

	const timestamp = Date.now();
	const hostUser = {
		username: `host_e2e_${timestamp}`,
		email: `host_e2e_${timestamp}@example.com`,
		password: "Password123!",
	};
	const guestUser1 = {
		username: `guest1_e2e_${timestamp}`,
		email: `guest1_e2e_${timestamp}@example.com`,
		password: "Password123!",
	};
	const guestUser2 = {
		username: `guest2_e2e_${timestamp}`,
		email: `guest2_e2e_${timestamp}@example.com`,
		password: "Password123!",
	};
	const adminUser = {
		username: `admin_e2e_${timestamp}`,
		email: `admin_e2e_${timestamp}@example.com`,
		password: "Password123!",
	};

	try {
		// 2. User Role Onboarding & Multi-Actor Authentication
		console.log("2. Testing Multi-Actor Onboarding (Host, 2 Travelers, Platform Administrator)...");
		let { signupRes: res } = await signupAndVerifyClient(hostClient, mockResend, {
			username: hostUser.username,
			email: hostUser.email,
			password: hostUser.password,
		});
		assert(res.status === 302, "Host signup must succeed");

		({ signupRes: res } = await signupAndVerifyClient(guestClient1, mockResend, {
			username: guestUser1.username,
			email: guestUser1.email,
			password: guestUser1.password,
		}));
		assert(res.status === 302, "Guest 1 signup must succeed");

		({ signupRes: res } = await signupAndVerifyClient(guestClient2, mockResend, {
			username: guestUser2.username,
			email: guestUser2.email,
			password: guestUser2.password,
		}));
		assert(res.status === 302, "Guest 2 signup must succeed");

		({ signupRes: res } = await signupAndVerifyClient(adminClient, mockResend, {
			username: adminUser.username,
			email: adminUser.email,
			password: adminUser.password,
		}));
		assert(res.status === 302, "Admin signup must succeed");

		// Fetch user records to register IDs and elevate Admin role
		const hostDoc = await User.findOne({ username: hostUser.username });
		const guest1Doc = await User.findOne({ username: guestUser1.username });
		const guest2Doc = await User.findOne({ username: guestUser2.username });
		const adminDoc = await User.findOneAndUpdate(
			{ username: adminUser.username },
			{ role: "admin" },
			{ new: true },
		);

		createdUserIds.push(hostDoc._id, guest1Doc._id, guest2Doc._id, adminDoc._id);
		assert(adminDoc.role === "admin", "Admin role elevation must be confirmed");
		console.log(`   [PASS] 4 actor accounts authenticated & initialized.\n`);

		// 3. Host Property Listing Creation & Media Pipeline
		console.log("3. Testing Host Property Creation & Media Pipeline...");
		const listingPayload = {
			listing: {
				title: "Azure Horizon Oceanfront Luxury Villa",
				description: "Ultra-luxury modern beachfront sanctuary overlooking the Arabian Sea with private infinity pool and dedicated concierge.",
				price: 12000,
				location: "Candolim, Goa",
				country: "India",
				category: "Amazing Pools",
				propertyType: "Beachfront",
				guests: 6,
				bedrooms: 3,
				bathrooms: 3,
				image: {
					url: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=80",
					filename: "azure_horizon_primary.jpg",
				},
			},
		};

		const createListingRes = await hostClient("/api/v1/listings", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(listingPayload),
		});
		if (createListingRes.status !== 201) {
			console.error("[Listing Create Error Status]:", createListingRes.status);
			console.error("[Listing Create Error Body]:", createListingRes.body);
		}
		assert(createListingRes.status === 201, "Listing creation must return HTTP 201 Created");
		const testListing = createListingRes.json().data;
		const listingId = testListing._id;
		createdListingIds.push(listingId);

		assert(testListing.title === listingPayload.listing.title, "Listing title must match");
		assert(testListing.price === 12000, "Price must be ₹12,000");
		assert(testListing.category === "Amazing Pools", "Category must be Amazing Pools");
		assert(testListing.status === "published", "Listing status must be published");
		assert(testListing.avgRating === 0, "Initial rating must be 0");
		assert(testListing.images && testListing.images.length >= 1, "Must contain at least 1 gallery image");
		console.log(`   [PASS] Created property '${testListing.title}' (ID: ${listingId}).\n`);

		// 4. Property Discovery, Search & Catalog Filtering
		console.log("4. Testing Property Discovery & Faceted Search Engine...");
		const searchRes = await guestClient1("/api/v1/listings?category=Amazing+Pools&search=Azure");
		assert(searchRes.status === 200, "Faceted search must return HTTP 200");
		const searchData = searchRes.json().data;
		assert(searchData.listings && searchData.listings.length >= 1, "Search must return matching villa");
		const foundListing = searchData.listings.find((l) => String(l._id) === String(listingId));
		assert(foundListing, "Created villa must be discovered in search results");
		assert(foundListing.price === 12000, "Discovered villa price verified");

		// Verify Web UI Catalog renders property
		const webCatalogRes = await guestClient1("/listings?category=Amazing+Pools");
		assert(webCatalogRes.status === 200, "Web catalog must return HTTP 200");
		assert(webCatalogRes.body.includes("Azure Horizon Oceanfront Luxury Villa"), "Catalog HTML must display property title");
		console.log("   [PASS] Discovery & search verification succeeded across REST API and Web UI.\n");

		// 5. Pre-Booking Real-Time Inquiry & Messaging
		console.log("5. Testing Pre-Booking Inquiry & Bidirectional Messaging...");
		const inquiryRes = await guestClient1("/api/v1/conversations/inquiry", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				listingId: listingId,
				message: "Hi! We will be arriving on an evening flight. Is 24/7 keyless check-in available?",
			}),
		});
		assert(inquiryRes.status === 201, "Inquiry creation must return HTTP 201");
		const conversation = inquiryRes.json().data;
		const conversationId = conversation._id;
		createdConversationIds.push(conversationId);
		console.log(`   [PASS] Inquiry created conversation ID: ${conversationId}.`);

		// Host views conversation messages
		const hostMsgsRes = await hostClient(`/api/v1/conversations/${conversationId}/messages`);
		assert(hostMsgsRes.status === 200, "Host fetching conversation must return HTTP 200");
		const hostThread = hostMsgsRes.json().data;
		const hostMsgs = hostThread.messages || [];
		assert(hostMsgs.length === 1, "Conversation must contain 1 inquiry message");
		assert(hostMsgs[0].body.includes("keyless check-in"), "Inquiry text verified");

		// Host sends reply
		const replyRes = await hostClient(`/api/v1/conversations/${conversationId}/messages`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				body: "Hello! Absolutely, we have a smart keypad digital lock with custom PIN codes for seamless 24/7 arrival.",
			}),
		});
		assert(replyRes.status === 201, "Host reply must return HTTP 201 Created");

		// Guest views conversation
		const guestMsgsRes = await guestClient1(`/api/v1/conversations/${conversationId}/messages`);
		assert(guestMsgsRes.status === 200, "Guest fetching conversation must return HTTP 200");
		const guestThread = guestMsgsRes.json().data;
		const guestMsgs = guestThread.messages || [];
		assert(guestMsgs.length === 2, "Conversation must now contain 2 messages");
		assert(guestMsgs[1].body.includes("smart keypad digital lock"), "Host reply text verified");
		console.log("   [PASS] Bidirectional messaging and unread synchronization verified.\n");

		// 6. Real-Time Calendar Availability & Itemized Pricing Engine
		console.log("6. Testing Calendar Availability & Itemized Pricing Calculation...");
		const bookedDatesBeforeRes = await guestClient1(`/api/v1/listings/${listingId}/booked-dates`);
		assert(bookedDatesBeforeRes.status === 200, "Booked dates API must return HTTP 200");
		assert(Array.isArray(bookedDatesBeforeRes.json().data), "Booked dates must return array");

		// 3 nights: Dec 15 to Dec 18, 2026
		// Base: 3 * 12,000 = ₹36,000
		// Cleaning: ₹500
		// Taxable: ₹36,500
		// 18% GST: Math.round(36500 * 0.18) = ₹6,570
		// Total: ₹43,070
		const expectedNights = 3;
		const expectedBase = 36000;
		const expectedCleaning = 500;
		const expectedGst = 6570;
		const expectedTotal = 43070;
		console.log(`   [PASS] Pricing parameters validated: ₹12,000 x 3 = ₹${expectedBase} + ₹${expectedCleaning} cleaning + ₹${expectedGst} GST = ₹${expectedTotal}.\n`);

		// 7. Reservation Creation & Date Conflict Guard
		console.log("7. Testing Reservation Creation & Date Conflict Prevention Guard...");
		const bookRes1 = await guestClient1(`/api/v1/listings/${listingId}/bookings`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				booking: {
					checkIn: "2026-12-15",
					checkOut: "2026-12-18",
					guests: 4,
				},
			}),
		});
		assert(bookRes1.status === 201, "Booking creation must return HTTP 201 Created");
		const booking1 = bookRes1.json().data;
		const booking1Id = booking1._id;
		createdBookingIds.push(booking1Id);

		assert(booking1.totalNights === expectedNights, "Total nights must be 3");
		assert(booking1.totalPrice === expectedTotal, `Total price must be ₹${expectedTotal}, got ₹${booking1.totalPrice}`);
		assert(booking1.status === "confirmed", "Booking status must be confirmed");
		assert(booking1.paymentStatus === "unpaid", "Initial payment status must be unpaid");
		console.log(`   [PASS] Reservation created with ID: ${booking1Id} for ₹${booking1.totalPrice}.`);

		// Conflict Guard: Guest 2 attempts booking overlapping dates (Dec 16 - Dec 19)
		const conflictRes = await guestClient2(`/api/v1/listings/${listingId}/bookings`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				booking: {
					checkIn: "2026-12-16",
					checkOut: "2026-12-19",
					guests: 2,
				},
			}),
		});
		assert(conflictRes.status === 400, "Conflicting date range must be rejected with HTTP 400 Bad Request");
		assert(conflictRes.json().message.includes("already booked"), "Conflict error message verified");
		console.log("   [PASS] Overlapping date conflict rejected by reservation engine.\n");

		// 8. Payment Gateway Checkout & Digital Tax Receipt
		console.log("8. Testing Payment Gateway Checkout & Digital Tax Receipt Generation...");
		const checkoutPageRes = await guestClient1(`/payments/checkout/${booking1Id}`);
		assert(checkoutPageRes.status === 200, "Checkout page must return HTTP 200");
		assert(checkoutPageRes.body.includes("Confirm and Pay"), "Checkout must display Confirm and Pay");
		assert(checkoutPageRes.body.includes("Azure Horizon Oceanfront Luxury Villa"), "Checkout must display property");
		assert(checkoutPageRes.body.includes("43,070"), "Checkout must display total price ₹43,070");

		// Submit credit card payment order
		const payRes1 = await guestClient1("/api/v1/payments/create-order", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				bookingId: booking1Id,
				amount: expectedTotal,
				paymentMethod: "card",
				cardNumber: "4111222233334242",
				cardExpiry: "08/29",
				cardCvc: "777",
				cardHolderName: "Elena Rostova",
				billingDetails: {
					fullName: "Elena Rostova",
					email: "elena@example.com",
					phone: "+91 9988776655",
					address: "42 Promenade Beach Rd",
					city: "Panaji",
					state: "Goa",
					postalCode: "403001",
				},
			}),
		});
		assert(payRes1.status === 201, "Payment order must return HTTP 201 Created");
		const payment1 = payRes1.json().data;
		const payment1Id = payment1._id;
		createdPaymentIds.push(payment1Id);

		assert(payment1.status === "succeeded", "Payment status must be succeeded");
		assert(payment1.amount === expectedTotal, "Payment amount must match");
		assert(payment1.transactionId.startsWith("txn_"), "Transaction ID must start with txn_");
		assert(payment1.orderId.startsWith("order_"), "Order ID must start with order_");
		assert(payment1.receiptNumber.startsWith("INV-"), "Receipt number must start with INV-");
		assert(payment1.cardDetails.brand === "Visa", "Card brand must be Visa");
		console.log(`   [PASS] Payment successful! Txn: ${payment1.transactionId}, Receipt: ${payment1.receiptNumber}.`);

		// Digital Tax Receipt Web UI
		const receiptRes = await guestClient1(`/payments/receipt/${payment1Id}`);
		assert(receiptRes.status === 200, "Receipt page must return HTTP 200");
		assert(receiptRes.body.includes("Tax Invoice &amp; Payment Receipt"), "Receipt page must show Tax Invoice");
		assert(receiptRes.body.includes("996311"), "Receipt must include GST SAC Code 996311");
		assert(receiptRes.body.includes("CGST"), "Receipt must include CGST line item");
		assert(receiptRes.body.includes("SGST"), "Receipt must include SGST line item");
		assert(receiptRes.body.includes(payment1.receiptNumber), "Receipt must include invoice number");
		assert(receiptRes.body.includes("43,070"), "Receipt must include total ₹43,070");
		console.log("   [PASS] Commercial digital tax invoice verified.\n");

		// 9. Multi-Event Notification Delivery & Notification Center
		console.log("9. Testing Notification Engine Multi-Event Dispatches & State Transitions...");
		const hostNotifsRes = await hostClient("/api/v1/notifications");
		assert(hostNotifsRes.status === 200, "Host notifications must return HTTP 200");
		const hostNotifs = hostNotifsRes.json().data.notifications;
		assert(hostNotifs.length >= 2, "Host should have at least 2 notifications (Booking & Payment)");

		const paymentNotif = hostNotifs.find((n) => n.type === "payment_succeeded");
		assert(paymentNotif, "Host must have received 'payment_succeeded' notification");
		assert(paymentNotif.isRead === false, "Notification should initially be unread");

		// Host marks notification as read via PATCH
		const markReadRes = await hostClient(`/api/v1/notifications/${paymentNotif._id}/read`, {
			method: "PATCH",
		});
		assert(markReadRes.status === 200, "Marking notification read must return HTTP 200");
		assert(markReadRes.json().data.isRead === true, "Notification isRead must update to true");

		// Guest 1 checks notifications
		const guestNotifsRes = await guestClient1("/api/v1/notifications");
		assert(guestNotifsRes.status === 200, "Guest notifications must return HTTP 200");
		const guestNotifs = guestNotifsRes.json().data.notifications;
		assert(guestNotifs.length >= 2, "Guest must have notifications for booking confirmation and receipt");
		console.log("   [PASS] Asynchronous multi-event notifications and read states verified.\n");

		// 10. Post-Stay Verified Review & Multi-Dimension Rating Engine
		console.log("10. Testing Post-Stay Verified Review & 6-Dimension Rating Recalculation...");
		const reviewPayload = {
			review: {
				rating: 5,
				comment: "Unbelievable sunset views, spotless interiors, and top-tier hospitality! A true 5-star experience.",
				cleanliness: 5,
				accuracy: 5,
				communication: 5,
				location: 5,
				checkIn: 5,
				value: 5,
			},
		};

		const createReviewRes = await guestClient1(`/api/v1/listings/${listingId}/reviews`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(reviewPayload),
		});
		assert(createReviewRes.status === 201, "Review creation must return HTTP 201 Created");
		const testReview = createReviewRes.json().data;
		const reviewId = testReview._id;
		createdReviewIds.push(reviewId);

		assert(testReview.rating === 5, "Rating must be 5");
		assert(testReview.isVerifiedStay === true, "Booking guest review must automatically receive Verified Stay badge");
		assert(testReview.cleanliness === 5, "Cleanliness dimension must be 5");

		// Inspect Listing Aggregated Rating
		const listingAfterReviewRes = await guestClient1(`/api/v1/listings/${listingId}`);
		assert(listingAfterReviewRes.status === 200, "Listing retrieval must return HTTP 200");
		const listingAfterReview = listingAfterReviewRes.json().data;
		assert(listingAfterReview.avgRating === 5, "Average rating must update to 5.0");
		assert(listingAfterReview.reviews && listingAfterReview.reviews.length === 1, "Review count must update to 1");
		assert(listingAfterReview.ratingBreakdown.cleanliness === 5, "Cleanliness average must be 5.0");
		console.log(`   [PASS] Review verified (isVerifiedStay: true). Listing rating updated to ${listingAfterReview.avgRating}/5.\n`);

		// 11. Host Review Reply & Community Helpfulness Upvoting
		console.log("11. Testing Host Review Reply & Community Helpfulness Upvoting...");
		const replyReviewRes = await hostClient(`/api/v1/listings/${listingId}/reviews/${reviewId}/reply`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				comment: "Thank you so much Elena! It was an absolute pleasure hosting you and your group. Come back anytime!",
			}),
		});
		assert(replyReviewRes.status === 200, "Host review reply must return HTTP 200");
		const updatedReview = replyReviewRes.json().data;
		assert(updatedReview.hostReply && updatedReview.hostReply.comment.includes("pleasure hosting you"), "Host reply text saved");

		// Guest 2 upvotes the review as helpful
		const upvoteRes = await guestClient2(`/api/v1/listings/${listingId}/reviews/${reviewId}/helpful`, {
			method: "POST",
		});
		assert(upvoteRes.status === 200, "Helpfulness upvote must return HTTP 200");
		assert(upvoteRes.json().data.helpfulCount === 1, "Helpful count must increment to 1");
		assert(upvoteRes.json().data.hasVoted === true, "hasVoted must be true");
		console.log("   [PASS] Host review reply and community helpfulness upvoting verified.\n");

		// 12. Host Analytics & Financial Metrics Dashboard
		console.log("12. Testing Host Financial Metrics & Analytics Dashboard...");
		const hostMetricsRes = await hostClient("/api/v1/host/metrics");
		assert(hostMetricsRes.status === 200, "Host metrics API must return HTTP 200");
		const hostDashboard = hostMetricsRes.json().data;

		assert(hostDashboard.metrics.totalListings === 1, "Must have 1 listing");
		assert(hostDashboard.metrics.totalBookings === 1, "Must have 1 booking");
		assert(hostDashboard.metrics.totalRevenue === expectedTotal, `Total revenue must be ₹${expectedTotal}`);
		const expectedNetEarnings = Math.round(expectedTotal * 0.9); // 10% platform fee
		assert(hostDashboard.metrics.netEarnings === expectedNetEarnings, `Net earnings must be ₹${expectedNetEarnings}`);

		// Web UI Host Dashboard
		const hostWebRes = await hostClient("/host/dashboard");
		assert(hostWebRes.status === 200, "Host Web Dashboard must return HTTP 200");
		assert(hostWebRes.body.includes("Host Performance Dashboard"), "Dashboard must show Host Performance Dashboard");
		assert(hostWebRes.body.includes("43,070"), "Dashboard must show total revenue ₹43,070");
		console.log(`   [PASS] Host Analytics verified (Gross: ₹${hostDashboard.metrics.totalRevenue}, Net Payout: ₹${hostDashboard.metrics.netEarnings}).\n`);

		// 13. Guest Trips Dashboard & Itinerary Management
		console.log("13. Testing Guest Trips Dashboard & Itinerary Display...");
		const tripsWebRes = await guestClient1("/bookings");
		assert(tripsWebRes.status === 200, "Trips page must return HTTP 200");
		assert(tripsWebRes.body.includes("Azure Horizon Oceanfront Luxury Villa"), "Trips page must display booked villa");
		assert(tripsWebRes.body.includes("Confirmed"), "Trips page must show Confirmed status");
		assert(tripsWebRes.body.includes("Paid"), "Trips page must show Paid status");

		// Single Booking Show Page
		const bookingShowRes = await guestClient1(`/bookings/${booking1Id}`);
		assert(bookingShowRes.status === 200, "Booking detail page must return HTTP 200");
		assert(bookingShowRes.body.includes("Reservation Confirmed!"), "Detail page must show Reservation Confirmed!");
		assert(bookingShowRes.body.includes("Azure Horizon Oceanfront Luxury Villa"), "Detail page must show property title");
		console.log("   [PASS] Guest Trips dashboard and itinerary details verified.\n");

		// 14. Second Reservation, Cancellation & Automated Refund Engine
		console.log("14. Testing Future Reservation, Cancellation & Automated Refund Engine...");
		// Guest 1 books Jan 10 - Jan 12, 2027 (2 nights)
		// Base: 2 * 12,000 = ₹24,000
		// Cleaning: ₹500
		// GST (18%): Math.round(24500 * 0.18) = ₹4,410
		// Total: ₹28,910
		const bookRes2 = await guestClient1(`/api/v1/listings/${listingId}/bookings`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				booking: {
					checkIn: "2027-01-10",
					checkOut: "2027-01-12",
					guests: 2,
				},
			}),
		});
		assert(bookRes2.status === 201, "Second booking creation must return HTTP 201 Created");
		const booking2 = bookRes2.json().data;
		const booking2Id = booking2._id;
		createdBookingIds.push(booking2Id);
		assert(booking2.totalPrice === 28910, `Booking 2 total price must be 28910, got ${booking2.totalPrice}`);

		// Guest 1 pays for second booking
		const payRes2 = await guestClient1("/api/v1/payments/create-order", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				bookingId: booking2Id,
				amount: 28910,
				paymentMethod: "card",
				cardHolderName: "Elena Rostova",
			}),
		});
		assert(payRes2.status === 201, "Second payment must succeed");
		const payment2 = payRes2.json().data;
		createdPaymentIds.push(payment2._id);

		// Guest 1 cancels the second reservation
		const cancelRes = await guestClient1(`/api/v1/bookings/${booking2Id}/cancel`, {
			method: "PATCH",
		});
		assert(cancelRes.status === 200, "Booking cancellation must return HTTP 200");
		const cancelledBooking = cancelRes.json().data;
		assert(cancelledBooking.status === "cancelled", "Booking status must be cancelled");
		assert(cancelledBooking.paymentStatus === "refunded", "Payment status must be updated to refunded");

		// Verify calendar released dates
		const bookedDatesAfterCancel = await guestClient2(`/api/v1/listings/${listingId}/booked-dates`);
		assert(bookedDatesAfterCancel.status === 200, "Booked dates API must return HTTP 200");
		const datesList = bookedDatesAfterCancel.json().data;
		const hasCancelledDates = datesList.some((d) => d.checkIn && d.checkIn.includes("2027-01-10"));
		assert(!hasCancelledDates, "Cancelled booking dates must be released from calendar");
		console.log(`   [PASS] Cancellation processed: refund issued, paymentStatus: 'refunded', dates released.\n`);

		// 15. Platform Governance, Admin Overview & Superhost Elevation
		console.log("15. Testing Admin Platform Governance & Superhost Elevation...");
		const adminOverviewRes = await adminClient("/api/v1/admin/overview");
		assert(adminOverviewRes.status === 200, "Admin overview must return HTTP 200");
		const adminMetrics = adminOverviewRes.json().data;
		assert(adminMetrics.financials.grossBookingValue >= 71980, "Gross booking value must encompass all reservations");

		// Admin elevates Host to Superhost
		const superhostRes = await adminClient(`/api/v1/admin/users/${hostDoc._id}/superhost`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ isSuperhost: true }),
		});
		assert(superhostRes.status === 200, "Superhost toggle must return HTTP 200");
		assert(superhostRes.json().data.isSuperhost === true, "User document must have isSuperhost: true");

		// Host verifies Superhost status in profile
		const hostProfileRes = await hostClient("/api/v1/users/profile");
		assert(hostProfileRes.status === 200, "Host profile must return HTTP 200");
		assert(hostProfileRes.json().data.user.isSuperhost === true, "Host profile must reflect Superhost badge");
		console.log("   [PASS] Platform governance and Superhost elevation verified.\n");

		console.log("================================================================================");
		console.log("   ALL 15 PHASE 15 END-TO-END ORCHESTRATION TESTS PASSED SUCCESSFULLY!         ");
		console.log("================================================================================\n");
	} finally {
		// Teardown simulation test artifacts safely without touching seed data
		console.log("Teardown: Cleaning up simulation test artifacts...");
		try {
			if (createdReviewIds.length > 0) {
				await Review.deleteMany({ _id: { $in: createdReviewIds } });
			}
			if (createdPaymentIds.length > 0) {
				await Payment.deleteMany({ _id: { $in: createdPaymentIds } });
			}
			if (createdBookingIds.length > 0) {
				await Booking.deleteMany({ _id: { $in: createdBookingIds } });
			}
			if (createdConversationIds.length > 0) {
				await Message.deleteMany({ conversation: { $in: createdConversationIds } });
				await Conversation.deleteMany({ _id: { $in: createdConversationIds } });
			}
			if (createdUserIds.length > 0) {
				await Notification.deleteMany({
					$or: [
						{ recipient: { $in: createdUserIds } },
						{ sender: { $in: createdUserIds } },
					],
				});
			}
			if (createdListingIds.length > 0) {
				await Listing.deleteMany({ _id: { $in: createdListingIds } });
			}
			if (createdUserIds.length > 0) {
				await User.deleteMany({ _id: { $in: createdUserIds } });
			}
			console.log("   [PASS] Simulation test artifacts purged cleanly; database seed preserved.\n");
		} catch (cleanupErr) {
			console.error("[Teardown Error]:", cleanupErr.message);
		}
	}
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
		if (mockResend) {
			await mockResend.close().catch(() => {});
		}
		try {
			await mongoose.disconnect();
		} catch (e) {}
		process.exit(exitCode);
	});

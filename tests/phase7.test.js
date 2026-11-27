const http = require("http");
const path = require("path");
const { fork } = require("child_process");

const PORT = 8087; // Dedicated port for Phase 7 test suite
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
	console.log("   WONDER-LUST PHASE 7 PAYMENT & ORDER TEST SUITE         ");
	console.log("==========================================================\n");

	// 1. Start Server on port 8087
	console.log("1. Starting Wonder-Lust test server on port 8087...");
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

	console.log("   [PASS] Server ready on port 8087.\n");

	// 2. Setup Host, Guest 1, and Guest 2 User Accounts
	console.log("2. Setting up Host and Guest traveler accounts...");
	const hostClient = createClient();
	const guestClient1 = createClient();
	const guestClient2 = createClient();

	const hostName = `pay_host_${Date.now()}`;
	const guest1Name = `traveler_alpha_${Date.now()}`;
	const guest2Name = `traveler_beta_${Date.now()}`;

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
	console.log("   [PASS] Host and 2 Guest accounts authenticated.\n");

	// 3. Create a Property as Host
	console.log("3. Creating Test Property as Host...");
	const createListingRes = await hostClient("/api/v1/listings", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			listing: {
				title: "Udaipur Royal Heritage Palace",
				description: "Luxury lakeside palace suite overlooking Lake Pichola.",
				price: 10000,
				location: "Udaipur",
				country: "India",
				category: "Castles",
				propertyType: "Villa",
				guests: 4,
			},
		}),
	});
	assert(createListingRes.status === 201, "Host must be able to create listing");
	const testListing = createListingRes.json().data;
	const listingId = testListing._id;
	console.log(`   [PASS] Created property '${testListing.title}' with ID: ${listingId}.\n`);

	// 4. Create Reservation for Guest 1 (3 nights: ₹10,000 * 3 = ₹30,000 + ₹500 cleaning + 18% GST ₹5,490 = ₹35,990)
	console.log("4. Creating Reservation for Guest 1...");
	const bookRes = await guestClient1(`/api/v1/listings/${listingId}/bookings`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			booking: {
				checkIn: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
				checkOut: new Date(Date.now() + 33 * 86400000).toISOString().slice(0, 10),
				guests: 2,
			},
		}),
	});
	assert(bookRes.status === 201, "Reservation should be created with HTTP 201");
	const booking = bookRes.json().data;
	const bookingId = booking._id;
	assert(booking.totalPrice === 35990, `Total price should be 35990, got ${booking.totalPrice}`);
	console.log(`   [PASS] Created booking ID ${bookingId} for total ₹${booking.totalPrice}.\n`);

	// 5. Test Web UI Checkout Page Rendering (GET /payments/checkout/:bookingId)
	console.log("5. Testing Web UI Checkout Page Rendering...");
	const checkoutPageRes = await guestClient1(`/payments/checkout/${bookingId}`);
	assert(checkoutPageRes.status === 200, "Checkout page must return HTTP 200");
	assert(checkoutPageRes.body.includes("Confirm and Pay"), "Checkout page must show Confirm and Pay header");
	assert(checkoutPageRes.body.includes("Udaipur Royal Heritage Palace"), "Checkout must display property title");
	assert(checkoutPageRes.body.includes("35,990"), "Checkout must display total amount ₹35,990");
	assert(checkoutPageRes.body.includes("checkoutPaymentForm"), "Checkout must render payment form");
	assert(checkoutPageRes.body.includes("methodCardBtn"), "Checkout must render Card payment method");
	assert(checkoutPageRes.body.includes("methodUpiBtn"), "Checkout must render UPI payment method");
	assert(checkoutPageRes.body.includes("methodNetbankingBtn"), "Checkout must render NetBanking payment method");
	console.log("   [PASS] Web UI Checkout page verified.\n");

	// 6. Test Security: Unauthorized User Cannot Pay For Someone Else's Booking
	console.log("6. Testing Payment Authorization (Guest 2 attempting to pay Guest 1's booking)...");
	const unauthorizedPayRes = await guestClient2("/api/v1/payments/create-order", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			bookingId: bookingId,
			amount: 35990,
			paymentMethod: "card",
		}),
	});
	assert(unauthorizedPayRes.status === 403, "Paying for another user's booking must return HTTP 403 Forbidden");
	console.log("   [PASS] Unauthorized payment prevented.\n");

	// 7. Test Price Tampering Guard (Submitting lower amount)
	console.log("7. Testing Price Tampering Guard (Submitting amount lower than booking total)...");
	const tamperRes = await guestClient1("/api/v1/payments/create-order", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			bookingId: bookingId,
			amount: 100, // Tampered amount
			paymentMethod: "card",
		}),
	});
	assert(tamperRes.status === 400, "Amount mismatch must be rejected with HTTP 400 Bad Request");
	console.log("   [PASS] Price tampering rejected.\n");

	// 8. Test Successful Payment Order via REST API (POST /api/v1/payments/create-order)
	console.log("8. Testing Successful Payment Processing (Credit Card)...");
	const payRes = await guestClient1("/api/v1/payments/create-order", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			bookingId: bookingId,
			amount: 35990,
			paymentMethod: "card",
			cardNumber: "4111222233334242",
			cardExpiry: "12/28",
			cardCvc: "888",
			cardHolderName: "Alpha Traveler",
			billingDetails: {
				fullName: "Alpha Traveler",
				email: "alpha@example.com",
				phone: "+91 9876543210",
				address: "Flat 101 Lake View",
				city: "Udaipur",
				state: "Rajasthan",
				postalCode: "313001",
			},
		}),
	});
	assert(payRes.status === 201, "Payment order must return HTTP 201 Created");
	const payment = payRes.json().data;
	const paymentId = payment._id;
	assert(payment.status === "succeeded", "Payment status must be succeeded");
	assert(payment.amount === 35990, "Payment amount must be 35990");
	assert(payment.transactionId.startsWith("txn_"), "Transaction ID must follow txn_ format");
	assert(payment.orderId.startsWith("order_"), "Order ID must follow order_ format");
	assert(payment.receiptNumber.startsWith("INV-"), "Receipt number must start with INV-");
	assert(payment.cardDetails.brand === "Visa", "Card brand should be detected as Visa");
	assert(payment.cardDetails.last4 === "4242", "Card last 4 should be 4242");
	console.log(`   [PASS] Payment succeeded! Txn ID: ${payment.transactionId}, Invoice: ${payment.receiptNumber}.\n`);

	// 9. Test Duplicate Payment Rejection
	console.log("9. Testing Duplicate Payment Rejection...");
	const duplicatePayRes = await guestClient1("/api/v1/payments/create-order", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			bookingId: bookingId,
			amount: 35990,
			paymentMethod: "card",
		}),
	});
	assert(duplicatePayRes.status === 400, "Paying again for an already paid booking must return HTTP 400");
	console.log("   [PASS] Duplicate payment prevented.\n");

	// 10. Test Payment Receipt / Tax Invoice Page (GET /payments/receipt/:id)
	console.log("10. Testing Web UI Tax Invoice & Receipt (GET /payments/receipt/:id)...");
	const receiptPageRes = await guestClient1(`/payments/receipt/${paymentId}`);
	assert(receiptPageRes.status === 200, "Receipt page must return HTTP 200");
	assert(receiptPageRes.body.includes("Tax Invoice &amp; Payment Receipt"), "Receipt must include Tax Invoice header");
	assert(receiptPageRes.body.includes("PAYMENT CONFIRMED"), "Receipt must show PAYMENT CONFIRMED badge");
	assert(receiptPageRes.body.includes("996311"), "Receipt must include SAC/HSN code 996311");
	assert(receiptPageRes.body.includes("CGST"), "Receipt must include CGST line item");
	assert(receiptPageRes.body.includes("SGST"), "Receipt must include SGST line item");
	assert(receiptPageRes.body.includes(payment.transactionId), "Receipt must show transaction ID");
	assert(receiptPageRes.body.includes(payment.receiptNumber), "Receipt must show invoice number");
	assert(receiptPageRes.body.includes("Alpha Traveler"), "Receipt must show billed-to name");
	console.log("   [PASS] Digital Tax Invoice page verified.\n");

	// 11. Test Payment Retrieval APIs (GET /api/v1/payments/:id & GET /api/v1/payments/booking/:bookingId)
	console.log("11. Testing Payment Retrieval Endpoints...");
	const getPayRes = await guestClient1(`/api/v1/payments/${paymentId}`);
	assert(getPayRes.status === 200, "GET payment by ID should return 200");
	assert(getPayRes.json().data.transactionId === payment.transactionId, "Fetched payment must match transaction ID");

	const getPayBookingRes = await guestClient1(`/api/v1/payments/booking/${bookingId}`);
	assert(getPayBookingRes.status === 200, "GET payment by booking ID should return 200");
	assert(getPayBookingRes.json().data._id === paymentId, "Payment ID must match booking's payment");
	console.log("   [PASS] Payment lookup endpoints verified.\n");

	// 12. Test Booking Receipt Page Linking to Tax Invoice
	console.log("12. Testing Booking Receipt integration (GET /bookings/:id shows Invoice link)...");
	const bookingShowRes = await guestClient1(`/bookings/${bookingId}`);
	assert(bookingShowRes.status === 200, "Booking show page should return 200");
	assert(bookingShowRes.body.includes(`/payments/receipt/${paymentId}`), "Booking show page must link to digital tax invoice");
	console.log("   [PASS] Booking show page displays Tax Invoice link.\n");

	// 13. Test Cancellation & Automatic Refund Workflow
	console.log("13. Testing Cancellation and Automatic Refund Workflow...");
	const cancelRes = await guestClient1(`/api/v1/bookings/${bookingId}/cancel`, {
		method: "PATCH",
	});
	assert(cancelRes.status === 200, "Cancellation should return HTTP 200");
	assert(cancelRes.json().data.status === "cancelled", "Booking status must be cancelled");
	assert(cancelRes.json().data.paymentStatus === "refunded", "Booking paymentStatus must be refunded");

	// Verify payment record is now marked as refunded
	const verifyRefundPayRes = await guestClient1(`/api/v1/payments/${paymentId}`);
	const refundedPayment = verifyRefundPayRes.json().data;
	assert(refundedPayment.status === "refunded", "Payment status must update to refunded");
	assert(refundedPayment.refundAmount === 35990, "Refund amount must match payment total");
	assert(refundedPayment.refundId.startsWith("rfnd_"), "Refund ID must follow rfnd_ format");
	console.log(`   [PASS] Refund processed successfully with Refund ID: ${refundedPayment.refundId}.\n`);

	// 14. Verify Receipt Page Now Shows Refunded Status
	console.log("14. Verifying Tax Receipt reflects REFUNDED status...");
	const refundedReceiptRes = await guestClient1(`/payments/receipt/${paymentId}`);
	assert(refundedReceiptRes.status === 200, "Receipt page must return 200");
	assert(refundedReceiptRes.body.includes("REFUNDED"), "Receipt page must display REFUNDED badge");
	assert(refundedReceiptRes.body.includes("Full Refund Processed"), "Receipt must show Full Refund Processed notice");
	assert(refundedReceiptRes.body.includes(refundedPayment.refundId), "Receipt must display refund reference ID");
	console.log("   [PASS] Refund status and reference displayed on invoice.\n");

	// 15. Security: Guest 2 cannot view Guest 1's invoice
	console.log("15. Testing Receipt Access Control (Guest 2 attempting to view Guest 1's receipt)...");
	const forbiddenReceiptRes = await guestClient2(`/api/v1/payments/${paymentId}`);
	assert(forbiddenReceiptRes.status === 403, "Unauthorized receipt access must return HTTP 403 Forbidden");
	console.log("   [PASS] Receipt access control enforced.\n");

	// 16. Cleanup Test Property
	console.log("16. Cleaning up test listing & data...");
	await hostClient(`/listings/${listingId}?_method=DELETE`, { method: "POST" });
	console.log("   [PASS] Cleaned up test property.\n");

	console.log("==========================================================");
	console.log("   ALL 16 PHASE 7 AUTOMATED TESTS PASSED SUCCESSFULLY!    ");
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

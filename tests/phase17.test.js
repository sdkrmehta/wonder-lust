const path = require("path");
const { fork } = require("child_process");
const mongoose = require("mongoose");
const env = require("../config/env");

const User = require("../models/user");
const EmailOtp = require("../models/emailOtp");
const Listing = require("../models/listing");
const Booking = require("../models/booking");
const BookingNightLock = require("../models/bookingNightLock");
const Payment = require("../models/payment");
const WebhookEvent = require("../models/webhookEvent");
const Notification = require("../models/notification");
const { migrateLegacyEmailVerification } = require("../scripts/migrate-legacy-email-verification");
const {
	encodeForm,
	createHttpClient,
	extractCsrfToken,
	startMockResendServer,
	startMockRazorpayServer,
	buildDefaultSignupPayload,
	signupAndVerifyClient,
} = require("./helpers/testHarness");

const PORT = 8097;
const BASE_URL = `http://localhost:${PORT}`;

let serverProc;
let mockResend;
let mockRazorpay;

function assert(condition, message) {
	if (!condition) {
		throw new Error(`Assertion Failed: ${message}`);
	}
}

async function runTests() {
	console.log("========================================================================");
	console.log("   WONDER-LUST PHASE 17: OTP, PROFILE, BILLING & RAZORPAY LINKS SUITE  ");
	console.log("========================================================================\n");

	mockResend = await startMockResendServer();
	mockRazorpay = await startMockRazorpayServer();

	console.log(`1. Starting Wonder-Lust server on port ${PORT} with mocked Resend & Razorpay...`);
	serverProc = fork(path.join(__dirname, "../server.js"), [], {
		env: {
			...process.env,
			PORT: String(PORT),
			PAYMENT_PROVIDER: "razorpay",
			PAYMENT_GATEWAY_MODE: "strict",
			APP_BASE_URL: BASE_URL,
			RESEND_API_KEY: "re_test_mock_key_phase17",
			RESEND_FROM_EMAIL: "Wonder-Lust <no-reply@wonderlust.test>",
			RESEND_BASE_URL: mockResend.url,
			OTP_HASH_SECRET: "phase17-super-secret-hmac-key-for-otp-hashing",
			OTP_TTL_SECONDS: "300",
			OTP_MAX_ATTEMPTS: "5",
			OTP_RESEND_COOLDOWN_SECONDS: "60",
			RAZORPAY_API_BASE: mockRazorpay.url,
			RAZORPAY_KEY_ID: mockRazorpay.keyId,
			RAZORPAY_KEY_SECRET: mockRazorpay.keySecret,
			RAZORPAY_WEBHOOK_SECRET: mockRazorpay.webhookSecret,
		},
		stdio: "pipe",
	});

	await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error("Server startup timed out after 10 seconds"));
		}, 10000);

		serverProc.stdout.on("data", (data) => {
			if (data.toString().includes(`listening on port ${PORT}`)) {
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

	const createdListingIds = [];
	const createdUserIds = [];
	const createdBookingIds = [];
	const createdPaymentIds = [];
	const timestamp = Date.now();

	try {
		// 2. Signup Page UI, Country-Aware Address & Required/Optional Accessibility
		console.log("2. Testing Signup Page UI & Field Requirements...");
		const anonClient = createHttpClient(BASE_URL);
		const signupPageRes = await anonClient("/signup");
		assert(signupPageRes.status === 200, "GET /signup must return HTTP 200");
		for (const field of [
			'name="fullName"',
			'name="email"',
			'name="password"',
			'name="confirmPassword"',
			'name="addressLine1"',
			'name="addressLine2"',
			'name="landmark"',
			'name="city"',
			'name="state"',
			'name="postalCode"',
			'name="country"',
			'name="termsAccepted"',
			"data-toggle-password",
			"/terms",
			"/privacy",
		]) {
			assert(
				signupPageRes.body.includes(field),
				`Signup page must render ${field}`,
			);
		}
		assert(
			/<option value="India"[^>]*selected/i.test(signupPageRes.body),
			"Signup page must select India as default country",
		);
		assert(
			!/name=["']phone["'][^>]*required/i.test(signupPageRes.body),
			"Signup page must NOT enforce mandatory phone number registration",
		);
		assert(
			!signupPageRes.body.toLowerCase().includes("phone otp"),
			"Signup page must NOT contain phone OTP verification",
		);
		console.log("   [PASS] Signup UI renders complete fields, India default, toggles, and no phone OTP.\n");

		// 3. Signup Backend Validation & International Postal Codes + NoSQL Guards
		console.log("3. Testing Signup Validation (Missing fields, Weak/Mismatch password, India & Foreign PINs, NoSQL)...");
		const badMissing = await anonClient("/api/v1/users/signup", {
			method: "POST",
			headers: { Accept: "application/json" },
			body: buildDefaultSignupPayload({ addressLine1: "" }),
		});
		assert(badMissing.status === 400, `Missing addressLine1 must return 400, got ${badMissing.status}`);

		const badEmail = await anonClient("/api/v1/users/signup", {
			method: "POST",
			headers: { Accept: "application/json" },
			body: buildDefaultSignupPayload({ email: "invalid-email-format" }),
		});
		assert(badEmail.status === 400, "Invalid email must return 400");

		const badWeakPwd = await anonClient("/api/v1/users/signup", {
			method: "POST",
			headers: { Accept: "application/json" },
			body: buildDefaultSignupPayload({
				password: "weak",
				confirmPassword: "weak",
			}),
		});
		assert(badWeakPwd.status === 400, "Weak password must return 400");

		const badMismatchPwd = await anonClient("/api/v1/users/signup", {
			method: "POST",
			headers: { Accept: "application/json" },
			body: buildDefaultSignupPayload({
				password: "Password123",
				confirmPassword: "DifferentPassword123",
			}),
		});
		assert(badMismatchPwd.status === 400, "Password mismatch must return 400");

		const badTerms = await anonClient("/api/v1/users/signup", {
			method: "POST",
			headers: { Accept: "application/json" },
			body: buildDefaultSignupPayload({ termsAccepted: "" }),
		});
		assert(badTerms.status === 400, "Unchecked Terms acceptance must return 400");

		for (const badIndiaPin of ["12345", "40000A", "1234567", "000000"]) {
			const pinRes = await anonClient("/api/v1/users/signup", {
				method: "POST",
				headers: { Accept: "application/json" },
				body: buildDefaultSignupPayload({
					country: "India",
					postalCode: badIndiaPin,
				}),
			});
			assert(
				pinRes.status === 400,
				`Invalid India PIN '${badIndiaPin}' must return 400, got ${pinRes.status}`,
			);
		}

		const badForeignPin = await anonClient("/api/v1/users/signup", {
			method: "POST",
			headers: { Accept: "application/json" },
			body: buildDefaultSignupPayload({
				country: "United States",
				postalCode: "!!!",
			}),
		});
		assert(badForeignPin.status === 400, "Invalid non-India postal code must return 400");

		const nosqlSignupRes = await anonClient("/api/v1/users/signup", {
			method: "POST",
			headers: { Accept: "application/json" },
			body: {
				...buildDefaultSignupPayload(),
				email: { $gt: "" },
			},
		});
		assert(nosqlSignupRes.status === 400, "NoSQL operator object in email must be rejected (400)");

		// Valid international signup (UK alphanumeric postal code SW1A 1AA)
		const ukEmail = `uk_guest_${timestamp}@example.com`;
		const ukClient = createHttpClient(BASE_URL);
		const ukPayload = buildDefaultSignupPayload({
			fullName: "Eleanor Vance",
			username: `uk_guest_${timestamp}`,
			email: ukEmail,
			country: "United Kingdom",
			postalCode: "SW1A 1AA",
			state: "Greater London",
			city: "London",
		});
		const ukSignupRes = await ukClient("/api/v1/users/signup", {
			method: "POST",
			headers: { Accept: "application/json" },
			body: ukPayload,
		});
		assert(ukSignupRes.status === 201, `UK postal code SW1A 1AA should succeed, got ${ukSignupRes.status}`);
		const ukOtp = await mockResend.waitForOtp(ukEmail);
		const ukVerifyRes = await ukClient("/api/v1/users/verify-email", {
			method: "POST",
			headers: { Accept: "application/json" },
			body: { email: ukEmail, otp: ukOtp },
		});
		assert(ukVerifyRes.status === 200 && ukVerifyRes.json().data.verified === true, "UK user OTP verification must succeed");
		const ukUserDoc = await User.findOne({ email: ukEmail });
		if (ukUserDoc) createdUserIds.push(ukUserDoc._id);
		assert(ukUserDoc && ukUserDoc.postalCode === "SW1A 1AA", "UK postal code must be persisted");
		console.log("   [PASS] Signup validation, India 6-digit PINs, UK postal codes, and NoSQL guards verified.\n");

		// 4. Unverified Account Gating, Plaintext OTP Non-Exposure & Resend Rollback on Error
		console.log("4. Testing Unverified Account Gating, OTP Hashing & Resend Failure Rollback...");
		mockResend.setFailureMode({ failNext: 1, statusCode: 500, message: "Resend temporary outage" });
		const rollbackEmail = `rollback_${timestamp}@example.com`;
		const rollbackRes = await anonClient("/api/v1/users/signup", {
			method: "POST",
			headers: { Accept: "application/json" },
			body: buildDefaultSignupPayload({
				username: `rollback_${timestamp}`,
				email: rollbackEmail,
			}),
		});
		assert(rollbackRes.status >= 500, `Resend failure must return 5xx error, got ${rollbackRes.status}`);
		const rolledBackUser = await User.findOne({ email: rollbackEmail });
		assert(!rolledBackUser, "Failed initial OTP email delivery must roll back unverified User creation");
		assert(
			!JSON.stringify(rollbackRes.body).includes("re_test_mock_key"),
			"Error responses must never expose RESEND_API_KEY",
		);

		// Create primary customer account via browser form POST /signup
		const customerClient = createHttpClient(BASE_URL);
		const customerEmailRaw = `  Aarav.Sharma.${timestamp}@Example.COM `;
		const customerEmail = `aarav.sharma.${timestamp}@example.com`;
		const customerUsername = `aarav_${timestamp}`;
		const customerPassword = "StrongPass123!";
		const customerSignupPayload = buildDefaultSignupPayload({
			fullName: "Aarav Sharma",
			username: customerUsername,
			email: customerEmailRaw,
			password: customerPassword,
			confirmPassword: customerPassword,
			addressLine1: "742 Marine Drive",
			addressLine2: "Floor 3, Sea View Wing",
			landmark: "Opposite Oval Maidan",
			city: "Mumbai",
			state: "Maharashtra",
			postalCode: "400020",
			country: "India",
			termsAccepted: "true",
		});

		const browserSignupRes = await customerClient("/signup", {
			method: "POST",
			body: encodeForm(customerSignupPayload),
		});
		assert(
			browserSignupRes.status === 302 && browserSignupRes.headers.location === "/verify-email",
			`Browser signup must redirect to /verify-email without auto-login, got ${browserSignupRes.status} -> ${browserSignupRes.headers.location}`,
		);

		const sentOtpEmail = mockResend.getLatestEmailFor(customerEmail);
		assert(sentOtpEmail && sentOtpEmail.otp, "Resend must receive verification email with 6-digit OTP");
		assert(sentOtpEmail.from === "Wonder-Lust <no-reply@wonderlust.test>", "Sender must come from RESEND_FROM_EMAIL");
		const initialOtp = sentOtpEmail.otp;
		assert(/^\d{6}$/.test(initialOtp), "OTP must be a 6-digit code");
		assert(!browserSignupRes.body.includes(initialOtp), "Signup response must NEVER contain plaintext OTP");

		// Inspect MongoDB documents directly
		const pendingUserDoc = await User.findOne({ email: customerEmail }).lean();
		assert(pendingUserDoc, "Pending user must exist under normalized lowercase email");
		createdUserIds.push(pendingUserDoc._id);
		assert(pendingUserDoc.emailVerified === false, "Newly signed-up user must have emailVerified === false");
		assert(pendingUserDoc.confirmPassword === undefined, "confirmPassword must NEVER be persisted in User");
		assert(pendingUserDoc.addressLine1 === "742 Marine Drive", "Registration addressLine1 must be saved");

		const otpDocs = await EmailOtp.find({ email: customerEmail }).lean();
		assert(otpDocs.length === 1, "Exactly one EmailOtp record must exist");
		assert(/^[a-f0-9]{64}$/.test(otpDocs[0].otpHash), "EmailOtp must store 64-hex SHA256 HMAC hash");
		assert(
			!JSON.stringify(otpDocs[0]).includes(initialOtp),
			"MongoDB EmailOtp document must NEVER store plaintext OTP",
		);

		// Unverified user must NOT be able to sign in or access protected routes
		const unverifiedProfileAttempt = await customerClient("/api/v1/users/profile", {
			headers: { Accept: "application/json" },
		});
		assert(unverifiedProfileAttempt.status === 401, "Unverified user session must not access /api/v1/users/profile");

		const unverifiedLoginClient = createHttpClient(BASE_URL);
		const unverifiedLoginRes = await unverifiedLoginClient("/login", {
			method: "POST",
			body: encodeForm({ username: customerEmail, password: customerPassword }),
		});
		assert(
			unverifiedLoginRes.status === 302 && unverifiedLoginRes.headers.location === "/verify-email",
			`Unverified login must be blocked and redirected to /verify-email, got ${unverifiedLoginRes.status} -> ${unverifiedLoginRes.headers.location}`,
		);
		const unverifiedProtectedRes = await unverifiedLoginClient("/profile/edit");
		assert(
			unverifiedProtectedRes.status === 302 && unverifiedProtectedRes.headers.location === "/login",
			"Rejected login must not establish an authenticated session",
		);
		console.log("   [PASS] Unverified user blocked from login/profile, OTP hashed, Resend failure rolled back.\n");

		// 5. Verification Page UI, Wrong OTP, Cooldown, Resend Invalidation, Expiry & 5-Attempt Lockout
		console.log("5. Testing OTP Verification UI, Wrong Attempts, Cooldown, Invalidation, Expiry & Lockout...");
		const verifyPageRes = await customerClient("/verify-email");
		assert(verifyPageRes.status === 200, "GET /verify-email must return HTTP 200");
		assert(verifyPageRes.body.includes("Verify your email"), "Verification page must display heading");
		assert(verifyPageRes.body.includes('name="otp"'), "Verification page must include OTP input");
		assert(verifyPageRes.body.includes("/verify-email/resend"), "Verification page must include Resend action");
		assert(!verifyPageRes.body.includes(initialOtp), "Verification page HTML must NEVER leak OTP");

		// Test wrong OTP increments attempts
		const wrongOtpAttempt = initialOtp === "000000" ? "999999" : "000000";
		const wrongRes = await customerClient("/api/v1/users/verify-email", {
			method: "POST",
			headers: { Accept: "application/json" },
			body: { email: customerEmail, otp: wrongOtpAttempt },
		});
		assert(wrongRes.status === 400, `Incorrect OTP must return 400, got ${wrongRes.status}`);
		let currentOtpDoc = await EmailOtp.findOne({ _id: otpDocs[0]._id }).lean();
		assert(currentOtpDoc.attempts === 1, `Expected failed attempts=1, got ${currentOtpDoc.attempts}`);

		// Test 60s resend cooldown enforced immediately
		const cooldownRes = await customerClient("/api/v1/users/verify-email/resend", {
			method: "POST",
			headers: { Accept: "application/json" },
			body: { email: customerEmail },
		});
		assert(cooldownRes.status === 429, `Immediate resend within 60s must return 429, got ${cooldownRes.status}`);

		// Simulate elapsed 65s cooldown cleanly in DB and resend OTP
		await EmailOtp.updateOne(
			{ _id: otpDocs[0]._id },
			{ $set: { lastSentAt: new Date(Date.now() - 65000) } },
		);
		const resendOkRes = await customerClient("/api/v1/users/verify-email/resend", {
			method: "POST",
			headers: { Accept: "application/json" },
			body: { email: customerEmail },
		});
		assert(resendOkRes.status === 200, `Resend after cooldown must return 200, got ${resendOkRes.status}`);
		const secondOtp = await mockResend.waitForOtp(customerEmail, 4000, 1);
		assert(/^\d{6}$/.test(secondOtp), "Second OTP must be 6 digits");

		// Old OTP must now be invalidated even though not expired
		const oldOtpRes = await customerClient("/api/v1/users/verify-email", {
			method: "POST",
			headers: { Accept: "application/json" },
			body: { email: customerEmail, otp: initialOtp },
		});
		assert(oldOtpRes.status === 400, "Previous OTP must be rejected after resend invalidation");

		// Expired OTP check (backdate expiresAt)
		const activeOtpDoc = await EmailOtp.findOne({
			email: customerEmail,
			consumedAt: null,
			invalidatedAt: null,
		}).lean();
		assert(activeOtpDoc, "Active EmailOtp must exist after resend");
		await EmailOtp.updateOne(
			{ _id: activeOtpDoc._id },
			{ $set: { expiresAt: new Date(Date.now() - 5000) } },
		);
		const expiredRes = await customerClient("/api/v1/users/verify-email", {
			method: "POST",
			headers: { Accept: "application/json" },
			body: { email: customerEmail, otp: secondOtp },
		});
		assert(
			expiredRes.status === 400 && /expired/i.test(expiredRes.body),
			`Expired OTP must return 400 with expired message, got ${expiredRes.status}: ${expiredRes.body}`,
		);

		// Anti-enumeration on resend for unknown email
		const unknownResendRes = await anonClient("/api/v1/users/verify-email/resend", {
			method: "POST",
			headers: { Accept: "application/json" },
			body: { email: `nonexistent_${timestamp}@example.com` },
		});
		assert(unknownResendRes.status === 200, "Unknown email resend must return generic 200 to prevent enumeration");

		// Issue fresh OTP for 5-attempt lockout check (bypass cooldown via DB)
		await EmailOtp.updateMany(
			{ email: customerEmail },
			{ $set: { lastSentAt: new Date(Date.now() - 65000) } },
		);
		const thirdResendRes = await customerClient("/api/v1/users/verify-email/resend", {
			method: "POST",
			headers: { Accept: "application/json" },
			body: { email: customerEmail },
		});
		assert(thirdResendRes.status === 200, "Third resend must succeed");
		const thirdOtp = await mockResend.waitForOtp(customerEmail, 4000, 2);
		const wrongThirdOtp = thirdOtp === "111111" ? "222222" : "111111";

		// 5 incorrect attempts -> 5th triggers max-attempts lockout (429), and valid OTP afterward fails!
		let lockoutSeen = false;
		for (let i = 1; i <= 5; i += 1) {
			const r = await customerClient("/api/v1/users/verify-email", {
				method: "POST",
				headers: { Accept: "application/json" },
				body: { email: customerEmail, otp: wrongThirdOtp },
			});
			if (r.status === 429) {
				lockoutSeen = true;
			}
		}
		assert(lockoutSeen, "5 incorrect OTP attempts must trigger HTTP 429 lockout");

		const postLockoutValidRes = await customerClient("/api/v1/users/verify-email", {
			method: "POST",
			headers: { Accept: "application/json" },
			body: { email: customerEmail, otp: thirdOtp },
		});
		assert(
			postLockoutValidRes.status >= 400,
			"Even valid OTP must be rejected once max attempts exhausted",
		);
		console.log("   [PASS] Wrong attempts, cooldown, resend invalidation, expiry, and 5-attempt lockout verified.\n");

		// 6. Rate Limiting Check & Final Successful Verification (Browser Flow + Reuse Prevention)
		console.log("6. Testing Rate Limiting, Successful Browser OTP Verification & Single-Use Enforcement...");
		const rateClient = createHttpClient(BASE_URL);
		let rateLimited = false;
		for (let i = 0; i < 6; i += 1) {
			const rl = await rateClient("/api/v1/users/verify-email/resend", {
				method: "POST",
				headers: {
					Accept: "application/json",
					"x-test-rate-limit": "true",
				},
				body: { email: `ratelimit_${timestamp}@example.com` },
			});
			if (rl.status === 429) {
				rateLimited = true;
				break;
			}
		}
		assert(rateLimited, "Repeated OTP resend requests must trigger express-rate-limit 429");

		// Re-issue final valid OTP and complete browser POST /verify-email
		await EmailOtp.updateMany(
			{ email: customerEmail },
			{ $set: { lastSentAt: new Date(Date.now() - 65000) } },
		);
		const browserResendRes = await customerClient("/verify-email/resend", {
			method: "POST",
			body: encodeForm({ email: customerEmail }),
		});
		assert(browserResendRes.status === 302, "Browser resend must redirect cleanly");
		const finalOtp = await mockResend.waitForOtp(customerEmail, 4000, 3);

		const verifySuccessRes = await customerClient("/verify-email", {
			method: "POST",
			body: encodeForm({ email: customerEmail, otp: finalOtp }),
		});
		assert(
			verifySuccessRes.status === 302 && verifySuccessRes.headers.location === "/listings",
			`Valid OTP must authenticate & redirect to /listings, got ${verifySuccessRes.status} -> ${verifySuccessRes.headers.location}`,
		);

		const verifiedUserDoc = await User.findOne({ email: customerEmail }).lean();
		assert(verifiedUserDoc.emailVerified === true, "User.emailVerified must be true after OTP verification");
		assert(Boolean(verifiedUserDoc.emailVerifiedAt), "User.emailVerifiedAt must be recorded");

		// Single-use reuse of already-consumed OTP must fail
		const reuseRes = await anonClient("/api/v1/users/verify-email", {
			method: "POST",
			headers: { Accept: "application/json" },
			body: { email: customerEmail, otp: finalOtp },
		});
		assert(reuseRes.status === 400, "Already consumed OTP must never be accepted twice");

		// Duplicate registration against verified account must fail generically without exposing existence
		const dupRes = await anonClient("/api/v1/users/signup", {
			method: "POST",
			headers: { Accept: "application/json" },
			body: buildDefaultSignupPayload({
				username: `dup_user_${timestamp}`,
				email: customerEmail,
			}),
		});
		assert(
			dupRes.status >= 400 && !/already registered/i.test(dupRes.body),
			"Duplicate registration must be blocked with non-enumerating message",
		);
		console.log("   [PASS] Rate limit, browser OTP verification, single-use OTP & anti-enumeration verified.\n");

		// 7. Verified Login by Email & Username + Profile View/Edit & Email Protection
		console.log("7. Testing Verified Login (Email & Username), Profile View/Edit & Security Controls...");
		const emailLoginClient = createHttpClient(BASE_URL);
		const emailLoginRes = await emailLoginClient("/login", {
			method: "POST",
			body: encodeForm({ username: customerEmail, password: customerPassword }),
		});
		assert(
			emailLoginRes.status === 302 && emailLoginRes.headers.location !== "/login" && emailLoginRes.headers.location !== "/verify-email",
			`Verified user must be able to login with email address, got ${emailLoginRes.status} -> ${emailLoginRes.headers.location}`,
		);

		const profilePageRes = await customerClient("/profile");
		assert(profilePageRes.status === 200, "GET /profile must return HTTP 200");
		assert(profilePageRes.body.includes("Aarav Sharma"), "Profile must display full name");
		assert(profilePageRes.body.includes(customerEmail), "Profile must display verified email to owner");
		assert(profilePageRes.body.includes("742 Marine Drive"), "Profile must display saved addressLine1");
		assert(profilePageRes.body.includes("400020"), "Profile must display saved PIN code");

		// Owner updates name & address via API, while attempting to inject email/emailVerified/role changes
		const badProfilePin = await customerClient("/api/v1/users/profile", {
			method: "PUT",
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: {
				user: {
					fullName: "Aarav K. Sharma",
					addressLine1: "18 Residency Road",
					city: "Bengaluru",
					state: "Karnataka",
					postalCode: "5600",
					country: "India",
				},
			},
		});
		assert(badProfilePin.status === 400, "Profile update with invalid India PIN must fail with 400");

		const profileUpdateRes = await customerClient("/api/v1/users/profile", {
			method: "PUT",
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: {
				user: {
					fullName: "Aarav K. Sharma",
					addressLine1: "18 Residency Road",
					addressLine2: "Tower B, Flat 902",
					landmark: "Near Cubbon Park",
					city: "Bengaluru",
					state: "Karnataka",
					postalCode: "560001",
					country: "India",
				},
			},
		});
		assert(profileUpdateRes.status === 200, `Profile update must return 200, got ${profileUpdateRes.status}: ${profileUpdateRes.body}`);

		// Tampering with email / emailVerified / role must be blocked and leave verified account intact
		const silentTamperRes = await customerClient("/api/v1/users/profile", {
			method: "PUT",
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: {
				user: {
					fullName: "Hacker Override",
					email: "hacker-hijack@example.com",
					emailVerified: false,
					role: "admin",
				},
			},
		});
		assert(silentTamperRes.status === 400, `Silent email/role tamper must be rejected with 400, got ${silentTamperRes.status}`);

		const updatedUserDoc = await User.findById(verifiedUserDoc._id).lean();
		assert(updatedUserDoc.fullName === "Aarav K. Sharma", "Updated fullName must persist");
		assert(updatedUserDoc.addressLine1 === "18 Residency Road", "Updated addressLine1 must persist");
		assert(updatedUserDoc.postalCode === "560001", "Updated postalCode must persist");
		assert(updatedUserDoc.email === customerEmail, "Silent login email change via profile update must be blocked");
		assert(updatedUserDoc.emailVerified === true, "emailVerified must not be altered via profile update");
		assert(updatedUserDoc.role === "traveler", "role privilege escalation via profile update must be blocked");

		// Unauthenticated update rejected + Public profile hides private address & email
		const unauthPutRes = await anonClient("/api/v1/users/profile", {
			method: "PUT",
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: { user: { fullName: "Intruder" } },
		});
		assert(unauthPutRes.status === 401, "Unauthenticated profile update must return 401");

		const publicProfileRes = await ukClient(`/users/${verifiedUserDoc._id}`);
		assert(publicProfileRes.status === 200, "Public profile view must return 200");
		assert(!publicProfileRes.body.includes("18 Residency Road"), "Public profile must NEVER expose another user's street address");
		assert(!publicProfileRes.body.includes("560001"), "Public profile must NEVER expose another user's PIN code");
		assert(!publicProfileRes.body.includes(customerEmail), "Public profile must NEVER expose another user's email");
		console.log("   [PASS] Verified login, profile edit, silent email protection, and public privacy verified.\n");

		// 8. Legacy Account Access Preservation & Migration Script Strategy
		console.log("8. Testing Legacy Account Login Compatibility & Migration Script...");
		const legacyUsername = `legacy_user_${timestamp}`;
		const legacyEmail = `${legacyUsername}@example.com`;
		const unverifiedSiblingEmail = `pending_sibling_${timestamp}@example.com`;

		// Create legacy user with emailVerified explicitly removed (legacy doc shape)
		const legacyDoc = new User({
			username: legacyUsername,
			email: legacyEmail,
			fullName: "Legacy Traveler",
			city: "Jaipur",
			country: "India",
		});
		await legacyDoc.setPassword("LegacyPass123!");
		legacyDoc.emailVerified = undefined;
		await legacyDoc.save();
		await User.updateOne({ _id: legacyDoc._id }, { $unset: { emailVerified: 1 } });
		createdUserIds.push(legacyDoc._id);

		const unverifiedSiblingDoc = new User({
			username: `pending_sibling_${timestamp}`,
			email: unverifiedSiblingEmail,
			fullName: "Unverified New Signup",
			emailVerified: false,
		});
		await unverifiedSiblingDoc.setPassword("SiblingPass123!");
		await unverifiedSiblingDoc.save();
		createdUserIds.push(unverifiedSiblingDoc._id);

		// Legacy account without emailVerified field must still sign in cleanly
		const legacyClient = createHttpClient(BASE_URL);
		const legacyLoginRes = await legacyClient("/login", {
			method: "POST",
			body: encodeForm({ username: legacyEmail, password: "LegacyPass123!" }),
		});
		assert(
			legacyLoginRes.status === 302 && legacyLoginRes.headers.location !== "/verify-email" && legacyLoginRes.headers.location !== "/login",
			`Legacy user with undefined emailVerified must still log in, got ${legacyLoginRes.status} -> ${legacyLoginRes.headers.location}`,
		);

		// Dry-run and apply migration
		const dryRunResult = await migrateLegacyEmailVerification(User, { apply: false });
		assert(
			dryRunResult.mode === "dry-run" &&
				dryRunResult.legacyAccountsPendingBackfill >= 1 &&
				dryRunResult.modifiedCount === 0,
			"Migration dry-run must report legacy users without modifying database",
		);
		const afterDryLegacy = await User.findById(legacyDoc._id).lean();
		assert(afterDryLegacy.emailVerified === undefined, "Dry-run must not mutate legacy document");

		const applyResult = await migrateLegacyEmailVerification(User, { apply: true });
		assert(
			applyResult.mode === "apply" && applyResult.modifiedCount >= 1,
			"Migration apply must update legacy user",
		);
		const afterApplyLegacy = await User.findById(legacyDoc._id).lean();
		const afterApplySibling = await User.findById(unverifiedSiblingDoc._id).lean();
		assert(afterApplyLegacy.emailVerified === true && Boolean(afterApplyLegacy.emailVerifiedAt), "Legacy user must be marked emailVerified=true");
		assert(afterApplySibling.emailVerified === false, "Migration must NEVER mark explicitly unverified (false) accounts as verified");
		console.log("   [PASS] Legacy user access & safe non-destructive migration script verified.\n");

		// 9. Setup Host Listing + Bookings for Checkout Billing & Razorpay Hosted Payment Links
		console.log("9. Setting up Host Listing & Bookings for Checkout Billing + Razorpay Links...");
		const hostClient = createHttpClient(BASE_URL);
		const { payload: hostPayload } = await signupAndVerifyClient(hostClient, mockResend, {
			username: `plink_host_${timestamp}`,
			email: `plink_host_${timestamp}@example.com`,
		});
		const hostDoc = await User.findOne({ email: hostPayload.email }).lean();
		createdUserIds.push(hostDoc._id);

		const listingRes = await hostClient("/api/v1/listings", {
			method: "POST",
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: {
				listing: {
					title: "Coorg Rainforest Mist Estate",
					description: "Private coffee plantation cottage with valley views.",
					price: 6000,
					location: "Madikeri",
					country: "India",
					category: "Castles",
					propertyType: "Villa",
					guests: 4,
				},
			},
		});
		assert(listingRes.status === 201, `Listing creation must succeed, got ${listingRes.status}: ${listingRes.body}`);
		const listing = listingRes.json().data;
		createdListingIds.push(listing._id);

		// Booking 1: 2 nights (6000*2 = 12000 + 500 cleaning = 12500 + 18% GST 2250 = 14750)
		const book1Res = await customerClient(`/api/v1/listings/${listing._id}/bookings`, {
			method: "POST",
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: {
				booking: {
					checkIn: "2027-02-10",
					checkOut: "2027-02-12",
					guests: 2,
				},
			},
		});
		assert(book1Res.status === 201, "Booking 1 creation must return 201");
		const booking1 = book1Res.json().data;
		createdBookingIds.push(booking1._id);
		assert(booking1.status === "pending", "Unpaid booking must start as pending");

		// Booking 2 for testing saveBillingAsDefault=true & snapshot immutability
		const book2Res = await customerClient(`/api/v1/listings/${listing._id}/bookings`, {
			method: "POST",
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: {
				booking: {
					checkIn: "2027-02-15",
					checkOut: "2027-02-17",
					guests: 2,
				},
			},
		});
		assert(book2Res.status === 201, "Booking 2 creation must return 201");
		const booking2 = book2Res.json().data;
		createdBookingIds.push(booking2._id);

		// Booking 3 for webhook idempotency & cancellation/expiry lock release test
		const book3Res = await customerClient(`/api/v1/listings/${listing._id}/bookings`, {
			method: "POST",
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: {
				booking: {
					checkIn: "2027-02-20",
					checkOut: "2027-02-22",
					guests: 2,
				},
			},
		});
		assert(book3Res.status === 201, "Booking 3 creation must return 201");
		const booking3 = book3Res.json().data;
		createdBookingIds.push(booking3._id);

		// Verify checkout page prefills saved profile address & includes save checkbox & no custom card form
		const checkout1Res = await customerClient(`/payments/checkout/${booking1._id}`);
		assert(checkout1Res.status === 200, "Checkout page must return 200");
		for (const expected of [
			"Aarav K. Sharma",
			customerEmail,
			"18 Residency Road",
			"Tower B, Flat 902",
			"Near Cubbon Park",
			"Bengaluru",
			"Karnataka",
			"560001",
			"Save this address as my default billing address for future bookings.",
			"Continue to secure payment",
		]) {
			assert(
				checkout1Res.body.includes(expected),
				`Checkout page must prefill/include '${expected}'`,
			);
		}
		assert(!checkout1Res.body.includes("cardNumber"), "Checkout must NOT render raw card input");
		assert(!checkout1Res.body.includes("cardCvc"), "Checkout must NOT render raw CVV input");
		assert(
			!checkout1Res.body.includes("&\\#x20B9;"),
			"Checkout button must not contain escaped backslash before rupee entity",
		);
		const checkoutCsp = String(checkout1Res.headers["content-security-policy"] || "");
		assert(
			checkoutCsp.includes("https://razorpay.com") && checkoutCsp.includes("https://rzp.io"),
			`Checkout CSP form-action must allow apex https://razorpay.com and https://rzp.io, got: ${checkoutCsp}`,
		);
		const checkoutCsrfToken = extractCsrfToken(checkout1Res.body);
		assert(checkoutCsrfToken.length >= 32, "Checkout page must embed valid CSRF token");
		console.log("   [PASS] Checkout prefills saved address cleanly with hosted payment link UI.\n");

		// 10. Editable Billing Without Updating Default Profile, Payment Link API Verification & Gateway Errors
		console.log("10. Testing Editable One-Time Billing, Amount Tampering & Gateway Error Handling...");
		// Test amount tampering
		const tamperRes = await customerClient("/api/v1/payments/payment-links", {
			method: "POST",
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: {
				bookingId: booking1._id,
				amount: 500,
				billingDetails: {
					fullName: "One-Time Guest Name",
					email: "invoice-only@example.com",
					addressLine1: "99 Churchgate Street",
					city: "Mumbai",
					state: "Maharashtra",
					postalCode: "400020",
					country: "India",
				},
			},
		});
		assert(tamperRes.status === 400, "Frontend price tampering must return 400");

		// Test invalid Razorpay credentials / gateway failure
		mockRazorpay.setFailureMode({
			createLinkStatus: 401,
			createLinkMessage: "Authentication failed.",
		});
		const gwErrRes = await customerClient("/api/v1/payments/payment-links", {
			method: "POST",
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: {
				bookingId: booking1._id,
				amount: booking1.totalPrice,
				billingDetails: {
					fullName: "One-Time Guest Name",
					email: "invoice-only@example.com",
					addressLine1: "99 Churchgate Street",
					city: "Mumbai",
					state: "Maharashtra",
					postalCode: "400020",
					country: "India",
				},
			},
		});
		assert(
			gwErrRes.status === 502 || gwErrRes.status === 503,
			`Gateway error must return 502/503 safely, got ${gwErrRes.status}`,
		);
		assert(
			!gwErrRes.body.includes(mockRazorpay.keySecret),
			"Gateway error response must never expose RAZORPAY_KEY_SECRET",
		);
		mockRazorpay.setFailureMode({});

		// Simulated browser fetch() call (as used by public/js/checkout.js) with CSRF token + Origin + JSON Accept
		const badBrowserJsonRes = await customerClient(`/payments/process/${booking1._id}`, {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				"User-Agent": "Mozilla/5.0 Chrome/125.0",
				Origin: BASE_URL,
				"X-CSRF-Token": checkoutCsrfToken,
			},
			body: {
				saveAsDefaultAddress: false,
				billingDetails: {
					fullName: "Corporate Travel Desk",
					email: "corp-billing@example.com",
					addressLine1: "99 Churchgate Street",
					city: "Mumbai",
					state: "Maharashtra",
					postalCode: "000",
					country: "India",
				},
			},
		});
		assert(badBrowserJsonRes.status === 400 && badBrowserJsonRes.json()?.success === false, "Browser JSON checkout validation error must return 400 JSON");

		const browserJsonCheckoutRes = await customerClient(`/payments/process/${booking1._id}`, {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				"User-Agent": "Mozilla/5.0 Chrome/125.0",
				Origin: BASE_URL,
				"X-CSRF-Token": checkoutCsrfToken,
			},
			body: {
				saveAsDefaultAddress: false,
				billingDetails: {
					fullName: "Corporate Travel Desk",
					email: "corp-billing@example.com",
					addressLine1: "99 Churchgate Street",
					addressLine2: "Floor 8",
					landmark: "Near Eros Cinema",
					city: "Mumbai",
					state: "Maharashtra",
					postalCode: "400020",
					country: "India",
				},
			},
		});
		assert(
			browserJsonCheckoutRes.status === 201 &&
				browserJsonCheckoutRes.json()?.redirectUrl?.startsWith("https://rzp.io/i/plink_"),
			`Browser JSON checkout must return 201 + Razorpay redirectUrl, got ${browserJsonCheckoutRes.status}: ${browserJsonCheckoutRes.body}`,
		);
		createdPaymentIds.push(browserJsonCheckoutRes.json().data._id);

		// Fallback HTML form POST /payments/process/:bookingId (non-JS) with one-time billing edits (saveAsDefaultAddress unchecked)
		const browserCheckoutRes = await customerClient(`/payments/process/${booking1._id}`, {
			method: "POST",
			body: encodeForm({
				"billingDetails[fullName]": "Corporate Travel Desk",
				"billingDetails[email]": "corp-billing@example.com",
				"billingDetails[addressLine1]": "99 Churchgate Street",
				"billingDetails[addressLine2]": "Floor 8",
				"billingDetails[landmark]": "Near Eros Cinema",
				"billingDetails[city]": "Mumbai",
				"billingDetails[state]": "Maharashtra",
				"billingDetails[postalCode]": "400020",
				"billingDetails[country]": "India",
			}),
		});
		assert(
			browserCheckoutRes.status === 302 &&
				browserCheckoutRes.headers.location &&
				browserCheckoutRes.headers.location.startsWith("https://rzp.io/i/plink_"),
			`Browser checkout must redirect directly to Razorpay Hosted Payment Link short_url, got ${browserCheckoutRes.status} -> ${browserCheckoutRes.headers.location}`,
		);

		const payment1Doc = await Payment.findOne({ booking: booking1._id, status: { $in: ["pending", "created"] } }).lean();
		assert(payment1Doc && payment1Doc.paymentLinkId, "Payment 1 must store paymentLinkId");
		createdPaymentIds.push(payment1Doc._id);

		// Verify mockRazorpay link parameters (paise, INR, callback_url, reference_id, expire_by)
		const rzpLink1 = mockRazorpay.getLink(payment1Doc.paymentLinkId);
		assert(rzpLink1.amount === booking1.totalPrice * 100, "Razorpay amount must be integer paise");
		assert(rzpLink1.currency === "INR", "Razorpay currency must be INR");
		assert(
			rzpLink1.callback_url === `${BASE_URL}/payments/razorpay/callback`,
			`Callback URL must target /payments/razorpay/callback, got ${rzpLink1.callback_url}`,
		);
		assert(rzpLink1.callback_method === "get", "Callback method must be get");
		assert(rzpLink1.reference_id === payment1Doc.paymentLinkReferenceId, "Reference ID must match");
		assert(rzpLink1.expire_by > Math.floor(Date.now() / 1000), "expire_by must be in the future");

		// Confirm User profile was NOT modified since saveBillingAsDefault was unchecked
		const userAfterOneTime = await User.findById(verifiedUserDoc._id).lean();
		assert(userAfterOneTime.addressLine1 === "18 Residency Road", "Default address must remain unchanged when checkbox unchecked");
		assert(userAfterOneTime.email === customerEmail, "Verified login email must NEVER change during billing edit");
		console.log("   [PASS] Hosted Payment Link created, paise verified, and one-time billing left default profile untouched.\n");

		// 11. Callback Security: Invalid Signature, Non-Paid Status, Amount Mismatch, Valid Verification & Idempotency
		console.log("11. Testing Razorpay Callback Verification, Invalid Signatures, Non-Paid States & Idempotency...");
		// Invalid callback signature
		const badSigRes = await customerClient("/api/v1/payments/razorpay/verify-link", {
			method: "POST",
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: {
				razorpay_payment_id: "pay_fake_999",
				razorpay_payment_link_id: payment1Doc.paymentLinkId,
				razorpay_payment_link_reference_id: payment1Doc.paymentLinkReferenceId,
				razorpay_payment_link_status: "paid",
				razorpay_signature: "tampered_invalid_signature_hex",
			},
		});
		assert(badSigRes.status === 401, `Tampered callback signature must return 401, got ${badSigRes.status}`);

		// Cancelled / non-paid status must never confirm booking
		mockRazorpay.setLinkState(payment1Doc.paymentLinkId, { status: "cancelled" });
		const cancelledSig = mockRazorpay.signCallback({
			paymentLinkId: payment1Doc.paymentLinkId,
			referenceId: payment1Doc.paymentLinkReferenceId,
			status: "cancelled",
			paymentId: "pay_cancelled_1",
		});
		const cancelledCallbackRes = await customerClient("/api/v1/payments/razorpay/verify-link", {
			method: "POST",
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: {
				razorpay_payment_id: "pay_cancelled_1",
				razorpay_payment_link_id: payment1Doc.paymentLinkId,
				razorpay_payment_link_reference_id: payment1Doc.paymentLinkReferenceId,
				razorpay_payment_link_status: "cancelled",
				razorpay_signature: cancelledSig,
			},
		});
		assert(cancelledCallbackRes.status >= 400, "Cancelled link callback must NOT confirm booking");
		const booking1StillPending = await Booking.findById(booking1._id).lean();
		assert(booking1StillPending.status !== "confirmed", "Cancelled link must keep booking unconfirmed");

		// Issue fresh retry Payment Link on booking1 after cancelled attempt (testing retry workflow too)
		const retryLinkRes = await customerClient("/api/v1/payments/payment-links", {
			method: "POST",
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: {
				bookingId: booking1._id,
				amount: booking1.totalPrice,
				billingDetails: {
					fullName: "Corporate Travel Desk",
					email: "corp-billing@example.com",
					addressLine1: "99 Churchgate Street",
					addressLine2: "Floor 8",
					landmark: "Near Eros Cinema",
					city: "Mumbai",
					state: "Maharashtra",
					postalCode: "400020",
					country: "India",
				},
			},
		});
		assert(retryLinkRes.status === 201, `Retry payment link after cancellation must succeed, got ${retryLinkRes.status}`);
		const activePayment1 = retryLinkRes.json().data;
		createdPaymentIds.push(activePayment1._id);

		// Amount mismatch rejected even with valid HMAC signature
		const mismatchSim = mockRazorpay.simulatePaymentCaptured(activePayment1.paymentLinkId, {
			paymentAmount: 100, // Mismatched paise vs booking total
			amountPaid: 100,
			linkStatus: "paid",
		});
		const mismatchRes = await customerClient("/api/v1/payments/razorpay/verify-link", {
			method: "POST",
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: {
				razorpay_payment_id: mismatchSim.paymentId,
				razorpay_payment_link_id: mismatchSim.paymentLinkId,
				razorpay_payment_link_reference_id: mismatchSim.referenceId,
				razorpay_payment_link_status: "paid",
				razorpay_signature: mismatchSim.callbackSignature,
			},
		});
		assert(mismatchRes.status >= 400, `Payment amount mismatch must be rejected, got ${mismatchRes.status}`);

		// Valid full capture + browser callback redirect + duplicate callback idempotency
		mockRazorpay.clearRequests();
		const validCapture = mockRazorpay.simulatePaymentCaptured(activePayment1.paymentLinkId, {
			method: "upi",
		});
		const validCallbackRes = await customerClient(`/payments/razorpay/callback?${validCapture.callbackQueryString}`);
		assert(
			validCallbackRes.status === 302 && validCallbackRes.headers.location === `/payments/receipt/${activePayment1._id}`,
			`Valid callback must redirect to receipt, got ${validCallbackRes.status} -> ${validCallbackRes.headers.location}`,
		);
		const gatewayCallsDuringVerify = mockRazorpay.getRequests().map((r) => `${r.method} ${r.path}`);
		assert(
			gatewayCallsDuringVerify.some((c) => c.includes(`/payment_links/${activePayment1.paymentLinkId}`)),
			"Server must verify Payment Link status via Razorpay API",
		);
		assert(
			gatewayCallsDuringVerify.some((c) => c.includes(`/payments/${validCapture.paymentId}`)),
			"Server must verify captured Payment entity via Razorpay API",
		);

		const confirmedB1 = await Booking.findById(booking1._id).lean();
		const confirmedP1 = await Payment.findById(activePayment1._id).lean();
		assert(confirmedB1.status === "confirmed" && confirmedB1.paymentStatus === "paid", "Booking 1 must be confirmed + paid");
		assert(confirmedP1.status === "paid" && confirmedP1.transactionId === validCapture.paymentId, "Payment 1 must be paid with Razorpay payment_id");
		assert(confirmedB1.billingAddress.addressLine1 === "99 Churchgate Street", "Booking 1 must preserve edited billing snapshot");

		// Replay identical callback -> idempotent redirect, zero duplicate notifications
		const notifCountBeforeReplay = await Notification.countDocuments({ relatedBooking: booking1._id, type: "payment_succeeded" });
		const replayCallbackRes = await customerClient(`/payments/razorpay/callback?${validCapture.callbackQueryString}`);
		assert(
			replayCallbackRes.status === 302 && replayCallbackRes.headers.location === `/payments/receipt/${activePayment1._id}`,
			"Duplicate callback must be idempotent",
		);
		const notifCountAfterReplay = await Notification.countDocuments({ relatedBooking: booking1._id, type: "payment_succeeded" });
		assert(notifCountBeforeReplay === notifCountAfterReplay, "Duplicate callback must not send duplicate notifications");
		console.log("   [PASS] Invalid sigs, non-paid links, amount mismatch, API verification & idempotent callback verified.\n");

		// 12. Save Default Billing Address During Booking 2 & Verify Booking 1 Snapshot Immutability
		console.log("12. Testing Save Default Billing Address & Previous Booking Snapshot Immutability...");
		// Invalid PIN during checkout billing edit -> rejected 400
		const badCheckoutPinRes = await customerClient("/api/v1/payments/payment-links", {
			method: "POST",
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: {
				bookingId: booking2._id,
				amount: booking2.totalPrice,
				saveAsDefaultAddress: true,
				billingDetails: {
					fullName: "Aarav K. Sharma",
					email: customerEmail,
					addressLine1: "55 Indiranagar 100ft Rd",
					city: "Bengaluru",
					state: "Karnataka",
					postalCode: "999",
					country: "India",
				},
			},
		});
		assert(badCheckoutPinRes.status === 400, "Checkout billing edit with invalid PIN must return 400");

		const link2Res = await customerClient("/api/v1/payments/payment-links", {
			method: "POST",
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: {
				bookingId: booking2._id,
				amount: booking2.totalPrice,
				saveAsDefaultAddress: true,
				billingDetails: {
					fullName: "Aarav Pro Sharma",
					email: "finance-team@example.com",
					addressLine1: "55 Indiranagar 100ft Rd",
					addressLine2: "Suite 12",
					landmark: "Near CMH Road",
					city: "Bengaluru",
					state: "Karnataka",
					postalCode: "560038",
					country: "India",
				},
			},
		});
		assert(link2Res.status === 201, `Booking 2 payment link must return 201, got ${link2Res.status}`);
		const payment2Init = link2Res.json().data;
		createdPaymentIds.push(payment2Init._id);

		const userAfterSavedDefault = await User.findById(verifiedUserDoc._id).lean();
		assert(userAfterSavedDefault.addressLine1 === "55 Indiranagar 100ft Rd", "Saved default addressLine1 must update when checkbox is checked");
		assert(userAfterSavedDefault.postalCode === "560038", "Saved default postalCode must update");
		assert(userAfterSavedDefault.email === customerEmail, "Verified login email must STILL stay unchanged even when billing email changed");
		assert(userAfterSavedDefault.emailVerified === true, "emailVerified must stay true");

		// Booking 1 and Payment 1 snapshots must stay completely immutable!
		const b1SnapshotCheck = await Booking.findById(booking1._id).lean();
		const p1SnapshotCheck = await Payment.findById(activePayment1._id).lean();
		assert(
			b1SnapshotCheck.billingAddress.addressLine1 === "99 Churchgate Street" &&
				b1SnapshotCheck.billingAddress.postalCode === "400020",
			"Previous booking billing snapshot must remain immutable after later profile update",
		);
		assert(
			p1SnapshotCheck.billingDetails.addressLine1 === "99 Churchgate Street",
			"Previous payment invoice snapshot must remain immutable",
		);
		console.log("   [PASS] Default billing address saved cleanly and prior booking snapshots stayed immutable.\n");

		// 13. Signed Razorpay Webhooks: Verification, Idempotency & Cancelled/Expired Link Lock Release
		console.log("13. Testing Signed Razorpay Webhooks (Paid, Replay Idempotency, Invalid Sig & Cancelled Lock Release)...");
		// Complete Booking 2 purely via signed webhook (payment_link.paid)
		const sim2 = mockRazorpay.simulatePaymentCaptured(payment2Init.paymentLinkId, {
			method: "netbanking",
		});
		const paidEvent = mockRazorpay.buildWebhookPayload(
			"payment_link.paid",
			{
				payment_link: { entity: sim2.paymentLinkEntity },
				payment: { entity: sim2.paymentEntity },
			},
			`evt_paid_${timestamp}`,
		);

		// Tampered webhook signature rejected with 401
		const badWhRes = await anonClient("/api/v1/payments/webhook", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-razorpay-signature": "invalid_hmac_signature",
				"x-razorpay-event-id": paidEvent.eventId,
			},
			body: paidEvent.rawBody,
		});
		assert(badWhRes.status === 401, `Invalid X-Razorpay-Signature must return 401, got ${badWhRes.status}`);

		// Valid signed webhook confirms Booking 2
		const validWhRes = await anonClient("/api/v1/payments/webhook", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-razorpay-signature": paidEvent.signature,
				"x-razorpay-event-id": paidEvent.eventId,
			},
			body: paidEvent.rawBody,
		});
		assert(validWhRes.status === 200, `Valid webhook must return 200, got ${validWhRes.status}`);
		const whJson = validWhRes.json().data;
		assert(whJson.status === "paid" && whJson.webhookVerified === true, "Webhook must confirm payment and mark webhookVerified");

		const b2AfterWh = await Booking.findById(booking2._id).lean();
		assert(b2AfterWh.status === "confirmed" && b2AfterWh.paymentStatus === "paid", "Booking 2 must be confirmed after webhook");

		const whEventDoc = await WebhookEvent.findOne({ eventId: paidEvent.eventId }).lean();
		assert(whEventDoc, "WebhookEvent deduplication record must be persisted");

		// Duplicate webhook replay with same eventId -> idempotent=true & no duplicate notification
		const b2NotifsBefore = await Notification.countDocuments({ relatedBooking: booking2._id, type: "payment_succeeded" });
		const replayWhRes = await anonClient("/api/v1/payments/webhook", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-razorpay-signature": paidEvent.signature,
				"x-razorpay-event-id": paidEvent.eventId,
			},
			body: paidEvent.rawBody,
		});
		assert(replayWhRes.status === 200 && replayWhRes.json().data.idempotent === true, "Duplicate webhook event must return idempotent=true");
		const b2NotifsAfter = await Notification.countDocuments({ relatedBooking: booking2._id, type: "payment_succeeded" });
		assert(b2NotifsBefore === b2NotifsAfter, "Duplicate webhook replay must not trigger duplicate notifications");

		// Expired payment_link webhook on Booking 3 releases BookingNightLock so another guest can book!
		const link3Res = await customerClient("/api/v1/payments/payment-links", {
			method: "POST",
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: {
				bookingId: booking3._id,
				amount: booking3.totalPrice,
				billingDetails: {
					fullName: "Aarav Pro Sharma",
					email: customerEmail,
					addressLine1: "55 Indiranagar 100ft Rd",
					city: "Bengaluru",
					state: "Karnataka",
					postalCode: "560038",
					country: "India",
				},
			},
		});
		assert(link3Res.status === 201, "Booking 3 payment link must return 201");
		const payment3Init = link3Res.json().data;
		createdPaymentIds.push(payment3Init._id);

		const expiredLinkEntity = mockRazorpay.setLinkState(payment3Init.paymentLinkId, {
			status: "expired",
		});
		const expiredWh = mockRazorpay.buildWebhookPayload(
			"payment_link.expired",
			{
				payment_link: { entity: expiredLinkEntity },
			},
			`evt_exp_${timestamp}`,
		);
		const expiredWhRes = await anonClient("/api/v1/payments/webhook", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-razorpay-signature": expiredWh.signature,
				"x-razorpay-event-id": expiredWh.eventId,
			},
			body: expiredWh.rawBody,
		});
		assert(expiredWhRes.status === 200, "Expired webhook must return 200");
		const b3AfterExpire = await Booking.findById(booking3._id).lean();
		assert(b3AfterExpire.status === "cancelled", "Expired payment link webhook must cancel unpaid booking hold");
		const remainingLocks3 = await BookingNightLock.countDocuments({ booking: booking3._id });
		assert(remainingLocks3 === 0, "Expired payment link webhook must release BookingNightLock");

		// Another user (ukClient) can now book those exact released dates!
		const rebookRes = await ukClient(`/api/v1/listings/${listing._id}/bookings`, {
			method: "POST",
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: {
				booking: {
					checkIn: "2027-02-20",
					checkOut: "2027-02-22",
					guests: 2,
				},
			},
		});
		assert(rebookRes.status === 201, "Released dates from expired link must be immediately rebookable");
		createdBookingIds.push(rebookRes.json().data._id);
		console.log("   [PASS] Webhooks, invalid signature rejection, replay idempotency & expired hold release verified.\n");

		// 14. Paid Razorpay Booking Refund Flow Preservation
		console.log("14. Testing Cancellation & Razorpay Refund Flow Preservation...");
		const cancelPaidRes = await customerClient(`/api/v1/bookings/${booking1._id}/cancel`, {
			method: "PATCH",
			headers: { Accept: "application/json" },
		});
		assert(cancelPaidRes.status === 200, "Cancelling paid Razorpay booking must return 200");
		const cancelledB1 = cancelPaidRes.json().data;
		assert(cancelledB1.status === "cancelled" && cancelledB1.paymentStatus === "refunded", "Booking 1 must transition to cancelled/refunded");
		const refundedP1 = await Payment.findById(activePayment1._id).lean();
		assert(
			refundedP1.status === "refunded" && refundedP1.refundId && refundedP1.refundId.startsWith("rfnd_"),
			"Payment 1 must record Razorpay refundId rfnd_...",
		);
		console.log("   [PASS] Razorpay booking cancellation & refund verified.\n");

		console.log("========================================================================");
		console.log("   ALL 14 PHASE 17 SECURITY, OTP & RAZORPAY LINK TESTS PASSED!         ");
		console.log("========================================================================");
	} finally {
		// Cleanup test entities cleanly
		try {
			await WebhookEvent.deleteMany({ eventId: { $in: [`evt_paid_${timestamp}`, `evt_exp_${timestamp}`] } });
			if (createdBookingIds.length > 0) {
				await BookingNightLock.deleteMany({ booking: { $in: createdBookingIds } });
				await Notification.deleteMany({ relatedBooking: { $in: createdBookingIds } });
				await Booking.deleteMany({ _id: { $in: createdBookingIds } });
			}
			if (createdPaymentIds.length > 0) {
				await Payment.deleteMany({ _id: { $in: createdPaymentIds } });
			}
			if (createdListingIds.length > 0) {
				await Listing.deleteMany({ _id: { $in: createdListingIds } });
			}
			if (createdUserIds.length > 0) {
				await EmailOtp.deleteMany({ user: { $in: createdUserIds } });
				await User.deleteMany({ _id: { $in: createdUserIds } });
			}
		} catch (cleanupErr) {
			console.error("[Phase 17 Cleanup Warning]:", cleanupErr.message);
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
		if (mockRazorpay) {
			await mockRazorpay.close().catch(() => {});
		}
		try {
			await mongoose.disconnect();
		} catch (e) {}
		process.exit(exitCode);
	});

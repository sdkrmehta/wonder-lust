const http = require("http");
const crypto = require("crypto");

function encodeForm(data) {
	const params = new URLSearchParams();
	Object.entries(data || {}).forEach(([key, value]) => {
		if (value !== undefined && value !== null) {
			params.append(key, String(value));
		}
	});
	return params.toString();
}

function createHttpClient(baseUrl) {
	let cookies = {};

	async function request(urlPath, options = {}) {
		const method = options.method || "GET";
		const headers = { ...(options.headers || {}) };

		const cookieHeader = Object.entries(cookies)
			.map(([k, v]) => `${k}=${v}`)
			.join("; ");
		if (cookieHeader && !headers["Cookie"]) {
			headers["Cookie"] = cookieHeader;
		}

		let bodyBuffer = null;
		if (options.body !== undefined && options.body !== null) {
			if (Buffer.isBuffer(options.body)) {
				bodyBuffer = options.body;
			} else if (typeof options.body === "string") {
				bodyBuffer = Buffer.from(options.body);
				if (!headers["Content-Type"]) {
					headers["Content-Type"] = "application/x-www-form-urlencoded";
				}
			} else if (typeof options.body === "object") {
				bodyBuffer = Buffer.from(JSON.stringify(options.body));
				if (!headers["Content-Type"]) {
					headers["Content-Type"] = "application/json";
				}
			}
			headers["Content-Length"] = bodyBuffer.length;
		}

		return new Promise((resolve, reject) => {
			const req = http.request(
				`${baseUrl}${urlPath}`,
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
								const name = parts[0].trim();
								const val = parts.slice(1).join("=").trim();
								if (!val && cookieStr.includes("Max-Age=0")) {
									delete cookies[name];
								} else {
									cookies[name] = val;
								}
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
	}

	request.getCookies = () => ({ ...cookies });
	request.clearCookies = () => {
		cookies = {};
	};
	return request;
}

function extractCsrfToken(html) {
	const inputMatch = String(html || "").match(
		/<input[^>]*name=["']_csrf["'][^>]*value=["']([^"']+)["']/i,
	);
	if (inputMatch) return inputMatch[1];
	const metaMatch = String(html || "").match(
		/<meta[^>]*name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i,
	);
	return metaMatch ? metaMatch[1] : "";
}

function extractOtpFromEmail(text, html) {
	const source = `${text || ""}\n${html || ""}`;
	const match = source.match(/\b(\d{6})\b/);
	return match ? match[1] : null;
}

async function startMockResendServer() {
	const emails = [];
	const emailsByRecipient = new Map();
	let seq = 0;
	let failureMode = null;

	const server = http.createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => (raw += chunk));
		req.on("end", () => {
			if (req.method === "POST" && req.url === "/emails") {
				const auth = String(req.headers["authorization"] || "");
				if (!auth.startsWith("Bearer ") || auth.slice(7).trim().length < 5) {
					res.writeHead(401, { "Content-Type": "application/json" });
					res.end(
						JSON.stringify({
							statusCode: 401,
							name: "validation_error",
							message: "Missing or invalid Resend API key.",
						}),
					);
					return;
				}

				if (failureMode) {
					const shouldFail =
						failureMode.failNext === true ||
						(typeof failureMode.failNext === "number" && failureMode.failNext > 0);
					if (shouldFail) {
						if (typeof failureMode.failNext === "number") {
							failureMode.failNext -= 1;
							if (failureMode.failNext <= 0) {
								const statusCode = failureMode.statusCode || 500;
								const message = failureMode.message || "Simulated Resend delivery error";
								failureMode = null;
								res.writeHead(statusCode, { "Content-Type": "application/json" });
								res.end(JSON.stringify({ statusCode, name: "application_error", message }));
								return;
							}
						}
						res.writeHead(failureMode.statusCode || 500, {
							"Content-Type": "application/json",
						});
						res.end(
							JSON.stringify({
								statusCode: failureMode.statusCode || 500,
								name: "application_error",
								message: failureMode.message || "Simulated Resend delivery error",
							}),
						);
						return;
					}
				}

				let payload = {};
				try {
					payload = JSON.parse(raw || "{}");
				} catch {
					res.writeHead(400, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ statusCode: 400, message: "Invalid JSON" }));
					return;
				}

				seq += 1;
				const id = `re_email_mock_${seq}`;
				const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];
				const otp = extractOtpFromEmail(payload.text, payload.html);
				const record = {
					id,
					from: payload.from,
					to: recipients,
					subject: payload.subject,
					html: payload.html,
					text: payload.text,
					otp,
					createdAt: Date.now(),
				};
				emails.push(record);
				recipients.forEach((recipient) => {
					const normalized = String(recipient || "").trim().toLowerCase();
					if (!normalized) return;
					if (!emailsByRecipient.has(normalized)) {
						emailsByRecipient.set(normalized, []);
					}
					emailsByRecipient.get(normalized).push(record);
				});

				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ id }));
				return;
			}

			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ message: "Not found" }));
		});
	});

	await new Promise((resolve, reject) => {
		server.on("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});

	const addr = server.address();
	const url = `http://127.0.0.1:${addr.port}`;

	return {
		url,
		port: addr.port,
		getEmails: () => [...emails],
		getEmailsFor: (email) => {
			const normalized = String(email || "").trim().toLowerCase();
			return [...(emailsByRecipient.get(normalized) || [])];
		},
		getLatestEmailFor: (email) => {
			const normalized = String(email || "").trim().toLowerCase();
			const list = emailsByRecipient.get(normalized) || [];
			return list.length > 0 ? list[list.length - 1] : null;
		},
		getLatestOtpFor: (email) => {
			const normalized = String(email || "").trim().toLowerCase();
			const list = emailsByRecipient.get(normalized) || [];
			for (let i = list.length - 1; i >= 0; i -= 1) {
				if (list[i].otp) return list[i].otp;
			}
			return null;
		},
		waitForOtp: async (email, timeoutMs = 4000, minIndex = 0) => {
			const normalized = String(email || "").trim().toLowerCase();
			const deadline = Date.now() + timeoutMs;
			while (Date.now() < deadline) {
				const list = emailsByRecipient.get(normalized) || [];
				if (list.length > minIndex) {
					const latest = list[list.length - 1];
					if (latest && latest.otp) return latest.otp;
				}
				await new Promise((r) => setTimeout(r, 25));
			}
			throw new Error(`Timed out waiting for OTP email to ${normalized}`);
		},
		setFailureMode: (mode) => {
			failureMode = mode || null;
		},
		reset: () => {
			emails.length = 0;
			emailsByRecipient.clear();
			failureMode = null;
		},
		close: async () => {
			await new Promise((resolve) => server.close(resolve));
		},
	};
}

async function startMockRazorpayServer(options = {}) {
	const keyId = options.keyId || "rzp_test_mock_key_id";
	const keySecret = options.keySecret || "rzp_test_mock_secret_1234";
	const webhookSecret = options.webhookSecret || "rzp_webhook_mock_secret_123";

	const expectedAuth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
	const paymentLinks = new Map();
	const payments = new Map();
	const orders = new Map();
	const refunds = new Map();
	const requests = [];

	let seq = 0;
	let failureMode = {};

	const server = http.createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => (raw += chunk));
		req.on("end", () => {
			const reqUrl = (req.url || "/").split("?")[0];
			const normalizedPath = reqUrl.startsWith("/v1/") ? reqUrl.slice(3) : reqUrl;
			requests.push({
				method: req.method,
				path: reqUrl,
				timestamp: Date.now(),
			});

			const authHeader = String(req.headers["authorization"] || "");
			if (authHeader !== expectedAuth) {
				res.writeHead(401, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						error: {
							code: "BAD_REQUEST_ERROR",
							description: "Authentication failed.",
							source: "business",
							step: "payment_initiation",
							reason: "authentication_failed",
						},
					}),
				);
				return;
			}

			let body = {};
			if (raw) {
				try {
					body = JSON.parse(raw);
				} catch {
					body = {};
				}
			}

			const nowSec = Math.floor(Date.now() / 1000);

			// POST /payment_links
			if (req.method === "POST" && normalizedPath === "/payment_links") {
				if (failureMode.createLinkStatus) {
					res.writeHead(failureMode.createLinkStatus, {
						"Content-Type": "application/json",
					});
					res.end(
						JSON.stringify({
							error: {
								code: "GATEWAY_ERROR",
								description:
									failureMode.createLinkMessage || "Simulated Razorpay payment link error",
							},
						}),
					);
					return;
				}
				seq += 1;
				const id = `plink_mock_${seq}_${crypto.randomBytes(3).toString("hex")}`;
				const entity = {
					id,
					entity: "payment_link",
					amount: Number(body.amount),
					amount_paid: 0,
					currency: body.currency || "INR",
					description: body.description || "Wonder-Lust Booking",
					reference_id: body.reference_id,
					customer: body.customer || {},
					options: body.options || {},
					notes: body.notes || {},
					callback_url: body.callback_url,
					callback_method: body.callback_method || "get",
					expire_by: body.expire_by || nowSec + 1800,
					short_url: `https://rzp.io/i/${id}`,
					status: "created",
					payments: [],
					created_at: nowSec,
					updated_at: nowSec,
				};
				paymentLinks.set(id, entity);
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(entity));
				return;
			}

			// GET /payment_links/:id
			const fetchLinkMatch = normalizedPath.match(/^\/payment_links\/([^/]+)$/);
			if (req.method === "GET" && fetchLinkMatch) {
				if (failureMode.fetchLinkStatus) {
					res.writeHead(failureMode.fetchLinkStatus, {
						"Content-Type": "application/json",
					});
					res.end(
						JSON.stringify({
							error: {
								code: "GATEWAY_ERROR",
								description: "Simulated fetch payment link failure",
							},
						}),
					);
					return;
				}
				const link = paymentLinks.get(fetchLinkMatch[1]);
				if (!link) {
					res.writeHead(404, { "Content-Type": "application/json" });
					res.end(
						JSON.stringify({
							error: {
								code: "BAD_REQUEST_ERROR",
								description: "The id provided does not exist",
							},
						}),
					);
					return;
				}
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(link));
				return;
			}

			// POST /payment_links/:id/cancel
			const cancelLinkMatch = normalizedPath.match(/^\/payment_links\/([^/]+)\/cancel$/);
			if (req.method === "POST" && cancelLinkMatch) {
				const link = paymentLinks.get(cancelLinkMatch[1]);
				if (!link) {
					res.writeHead(404, { "Content-Type": "application/json" });
					res.end(
						JSON.stringify({
							error: { code: "BAD_REQUEST_ERROR", description: "Payment link not found" },
						}),
					);
					return;
				}
				link.status = "cancelled";
				link.updated_at = nowSec;
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(link));
				return;
			}

			// GET /payments/:id
			const fetchPayMatch = normalizedPath.match(/^\/payments\/([^/]+)$/);
			if (req.method === "GET" && fetchPayMatch) {
				const pay = payments.get(fetchPayMatch[1]);
				if (!pay) {
					res.writeHead(404, { "Content-Type": "application/json" });
					res.end(
						JSON.stringify({
							error: { code: "BAD_REQUEST_ERROR", description: "Payment id does not exist" },
						}),
					);
					return;
				}
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(pay));
				return;
			}

			// POST /payments/:id/refund
			const refundPayMatch = normalizedPath.match(/^\/payments\/([^/]+)\/refund$/);
			if (req.method === "POST" && refundPayMatch) {
				const pay = payments.get(refundPayMatch[1]);
				if (!pay) {
					res.writeHead(404, { "Content-Type": "application/json" });
					res.end(
						JSON.stringify({
							error: { code: "BAD_REQUEST_ERROR", description: "Payment id does not exist" },
						}),
					);
					return;
				}
				seq += 1;
				const refundId = `rfnd_mock_${seq}`;
				const refundEntity = {
					id: refundId,
					entity: "refund",
					amount: Number(body.amount || pay.amount),
					currency: pay.currency || "INR",
					payment_id: pay.id,
					notes: body.notes || {},
					status: "processed",
					created_at: nowSec,
				};
				pay.amount_refunded = (pay.amount_refunded || 0) + refundEntity.amount;
				pay.status = "refunded";
				refunds.set(refundId, refundEntity);
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(refundEntity));
				return;
			}

			// POST /orders
			if (req.method === "POST" && normalizedPath === "/orders") {
				seq += 1;
				const orderId = `order_mock_${seq}`;
				const orderEntity = {
					id: orderId,
					entity: "order",
					amount: Number(body.amount),
					amount_paid: 0,
					amount_due: Number(body.amount),
					currency: body.currency || "INR",
					receipt: body.receipt,
					status: "created",
					notes: body.notes || {},
					created_at: nowSec,
				};
				orders.set(orderId, orderEntity);
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(orderEntity));
				return;
			}

			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					error: { code: "BAD_REQUEST_ERROR", description: `Unhandled path: ${reqUrl}` },
				}),
			);
		});
	});

	await new Promise((resolve, reject) => {
		server.on("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});

	const addr = server.address();
	const url = `http://127.0.0.1:${addr.port}`;

	function signCallback({ paymentLinkId, referenceId, status, paymentId }) {
		const payload = `${paymentLinkId}|${referenceId}|${status}|${paymentId}`;
		return crypto.createHmac("sha256", keySecret).update(payload).digest("hex");
	}

	function simulatePaymentCaptured(plinkId, opts = {}) {
		const link = paymentLinks.get(plinkId);
		if (!link) {
			throw new Error(`Mock payment link not found: ${plinkId}`);
		}
		seq += 1;
		const paymentId = opts.paymentId || `pay_mock_${seq}_${crypto.randomBytes(3).toString("hex")}`;
		const orderId = opts.orderId || `order_mock_${seq}`;
		const paymentAmount = opts.paymentAmount !== undefined ? Number(opts.paymentAmount) : link.amount;
		const paymentStatus = opts.paymentStatus || "captured";
		const linkStatus = opts.linkStatus || "paid";
		const method = opts.method || "upi";

		const paymentEntity = {
			id: paymentId,
			entity: "payment",
			amount: paymentAmount,
			currency: link.currency || "INR",
			status: paymentStatus,
			order_id: orderId,
			method,
			captured: paymentStatus === "captured",
			vpa: method === "upi" ? "guest@okaxis" : null,
			card:
				method === "card"
					? { last4: "4242", network: "Visa", type: "credit" }
					: null,
			bank: method === "netbanking" ? "HDFC" : null,
			email: link.customer?.email || "guest@example.com",
			notes: {
				...(link.notes || {}),
				...(opts.notes || {}),
			},
			created_at: Math.floor(Date.now() / 1000),
		};
		payments.set(paymentId, paymentEntity);

		link.status = linkStatus;
		link.amount_paid = opts.amountPaid !== undefined ? Number(opts.amountPaid) : paymentAmount;
		link.updated_at = Math.floor(Date.now() / 1000);
		link.payments = [
			{
				payment_id: paymentId,
				status: paymentStatus,
				amount: paymentAmount,
				method,
			},
		];

		const callbackSignature = signCallback({
			paymentLinkId: link.id,
			referenceId: link.reference_id,
			status: link.status,
			paymentId,
		});

		const callbackQueryString = encodeForm({
			razorpay_payment_id: paymentId,
			razorpay_payment_link_id: link.id,
			razorpay_payment_link_reference_id: link.reference_id,
			razorpay_payment_link_status: link.status,
			razorpay_signature: callbackSignature,
		});

		return {
			paymentLinkId: link.id,
			paymentId,
			orderId,
			referenceId: link.reference_id,
			status: link.status,
			amount: paymentAmount,
			callbackSignature,
			callbackQueryString,
			paymentEntity,
			paymentLinkEntity: { ...link },
		};
	}

	function setLinkState(plinkId, updates = {}) {
		const link = paymentLinks.get(plinkId);
		if (!link) throw new Error(`Mock payment link not found: ${plinkId}`);
		Object.assign(link, updates, { updated_at: Math.floor(Date.now() / 1000) });
		return { ...link };
	}

	function buildWebhookPayload(eventName, payloadData, eventId = null) {
		const id = eventId || `evt_mock_${crypto.randomBytes(6).toString("hex")}`;
		const rawBody = JSON.stringify({
			entity: "event",
			account_id: "acc_mock_1",
			event: eventName,
			contains: Object.keys(payloadData || {}),
			payload: payloadData,
			created_at: Math.floor(Date.now() / 1000),
		});
		const signature = crypto
			.createHmac("sha256", webhookSecret)
			.update(rawBody)
			.digest("hex");
		return {
			rawBody,
			signature,
			eventId: id,
		};
	}

	return {
		url,
		port: addr.port,
		keyId,
		keySecret,
		webhookSecret,
		signCallback,
		simulatePaymentCaptured,
		setLinkState,
		buildWebhookPayload,
		getLink: (id) => paymentLinks.get(id),
		getPayment: (id) => payments.get(id),
		getRequests: () => [...requests],
		clearRequests: () => {
			requests.length = 0;
		},
		setFailureMode: (mode) => {
			failureMode = mode || {};
		},
		reset: () => {
			paymentLinks.clear();
			payments.clear();
			orders.clear();
			refunds.clear();
			requests.length = 0;
			failureMode = {};
		},
		close: async () => {
			await new Promise((resolve) => server.close(resolve));
		},
	};
}

function buildDefaultSignupPayload(overrides = {}) {
	const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
	const username = overrides.username !== undefined ? overrides.username : `user_${suffix}`;
	const email = overrides.email !== undefined ? overrides.email : `${username || "user_" + suffix}@example.com`;
	const password = overrides.password !== undefined ? overrides.password : "Password123";
	return {
		fullName: overrides.fullName !== undefined ? overrides.fullName : `Traveler ${username}`,
		username,
		email,
		password,
		confirmPassword:
			overrides.confirmPassword !== undefined ? overrides.confirmPassword : password,
		addressLine1: overrides.addressLine1 !== undefined ? overrides.addressLine1 : "42 MG Road, Camp",
		addressLine2: overrides.addressLine2 !== undefined ? overrides.addressLine2 : "Suite 4B",
		landmark: overrides.landmark !== undefined ? overrides.landmark : "Near Metro Station",
		city: overrides.city !== undefined ? overrides.city : "Mumbai",
		state: overrides.state !== undefined ? overrides.state : "Maharashtra",
		postalCode: overrides.postalCode !== undefined ? overrides.postalCode : "400001",
		country: overrides.country !== undefined ? overrides.country : "India",
		termsAccepted:
			overrides.termsAccepted !== undefined ? overrides.termsAccepted : "true",
	};
}

async function signupAndVerifyClient(client, mockResend, overrides = {}) {
	const payload = buildDefaultSignupPayload(overrides);
	const priorCount = mockResend.getEmailsFor(payload.email).length;

	const signupRes = await client("/signup", {
		method: "POST",
		body: encodeForm(payload),
	});

	if (signupRes.status !== 302) {
		throw new Error(
			`Expected 302 redirect after signup for ${payload.email}, got ${signupRes.status}: ${signupRes.body.slice(0, 300)}`,
		);
	}

	const otp = await mockResend.waitForOtp(payload.email, 5000, priorCount);
	const verifyRes = await client("/verify-email", {
		method: "POST",
		body: encodeForm({
			email: payload.email,
			otp,
		}),
	});

	if (verifyRes.status !== 302 || verifyRes.headers.location?.startsWith("/verify-email")) {
		throw new Error(
			`Expected authenticated redirect after OTP verification for ${payload.email}, got ${verifyRes.status} -> ${verifyRes.headers.location}`,
		);
	}

	return {
		payload,
		signupRes,
		verifyRes,
		otp,
	};
}

module.exports = {
	encodeForm,
	createHttpClient,
	extractCsrfToken,
	startMockResendServer,
	startMockRazorpayServer,
	buildDefaultSignupPayload,
	signupAndVerifyClient,
};

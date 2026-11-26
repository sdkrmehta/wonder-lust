(() => {
	function selectPaymentMethod(method) {
		const hiddenMethod = document.getElementById("selectedPaymentMethod");
		if (hiddenMethod) hiddenMethod.value = method;

		const cardBtn = document.getElementById("methodCardBtn");
		const upiBtn = document.getElementById("methodUpiBtn");
		const netBtn = document.getElementById("methodNetbankingBtn");

		const cardSec = document.getElementById("cardPaymentSection");
		const upiSec = document.getElementById("upiPaymentSection");
		const netSec = document.getElementById("netbankingPaymentSection");

		[cardBtn, upiBtn, netBtn].forEach((btn) => btn && btn.classList.remove("active-method-btn"));
		[cardSec, upiSec, netSec].forEach((sec) => sec && sec.classList.add("d-none"));

		if (method === "card") {
			if (cardBtn) cardBtn.classList.add("active-method-btn");
			if (cardSec) cardSec.classList.remove("d-none");
		} else if (method === "upi") {
			if (upiBtn) upiBtn.classList.add("active-method-btn");
			if (upiSec) upiSec.classList.remove("d-none");
		} else if (method === "netbanking") {
			if (netBtn) netBtn.classList.add("active-method-btn");
			if (netSec) netSec.classList.remove("d-none");
		}
	}
	window.selectPaymentMethod = selectPaymentMethod;

	function setUpiHandle(handle) {
		const upiInput = document.getElementById("upiId");
		if (upiInput) {
			const currentVal = upiInput.value.split("@")[0] || "traveler";
			upiInput.value = `${currentVal}@${handle}`;
		}
	}
	window.setUpiHandle = setUpiHandle;

	function readCheckoutConfig() {
		const el = document.getElementById("checkoutConfigData");
		if (!el) return null;
		try {
			return JSON.parse(el.textContent || "{}");
		} catch {
			return null;
		}
	}

	function setStatusMessage(level, text) {
		const alertBox = document.getElementById("paymentStatusAlert");
		if (!alertBox) return;
		alertBox.className = `alert alert-${level} mb-3 small`;
		alertBox.textContent = text;
	}

	function resetPayButton(btn, originalNodes) {
		if (!btn) return;
		btn.disabled = false;
		if (Array.isArray(originalNodes) && originalNodes.length > 0) {
			btn.replaceChildren(...originalNodes.map((n) => n.cloneNode(true)));
		}
	}

	function collectBillingDetails(form) {
		return {
			fullName: form.querySelector('[name="billingDetails[fullName]"]')?.value || "",
			email: form.querySelector('[name="billingDetails[email]"]')?.value || "",
			address: form.querySelector('[name="billingDetails[address]"]')?.value || "",
			city: form.querySelector('[name="billingDetails[city]"]')?.value || "",
			state: form.querySelector('[name="billingDetails[state]"]')?.value || "",
			postalCode: form.querySelector('[name="billingDetails[postalCode]"]')?.value || "",
		};
	}

	async function startBookingConfirmationPoll(bookingId, attemptsLeft = 10) {
		for (let i = 0; i < attemptsLeft; i++) {
			await new Promise((resolve) => setTimeout(resolve, 2500));
			try {
				const res = await fetch(`/api/v1/payments/booking/${encodeURIComponent(bookingId)}`, {
					headers: { Accept: "application/json" },
				});
				if (!res.ok) continue;
				const body = await res.json();
				const pay = body?.data;
				if (pay && pay.status === "succeeded" && pay._id) {
					setStatusMessage("success", "Payment confirmed! Redirecting to your receipt...");
					window.location.href = `/payments/receipt/${pay._id}`;
					return true;
				}
				if (pay && pay.status === "failed") {
					setStatusMessage("warning", "Latest payment attempt did not complete. You may try again.");
					return false;
				}
			} catch {
				// Ignore transient network poll error and retry
			}
		}
		return false;
	}

	async function handleRazorpayCheckout(form, cfg) {
		const btn = document.getElementById("submitPaymentBtn");
		const originalNodes = btn ? Array.from(btn.childNodes).map((n) => n.cloneNode(true)) : [];
		if (btn) {
			btn.disabled = true;
			btn.textContent = "Initializing Razorpay Checkout...";
		}

		try {
			const method = document.getElementById("selectedPaymentMethod")?.value || "card";
			const billingDetails = collectBillingDetails(form);
			const csrfToken =
				cfg.csrfToken ||
				document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") ||
				"";

			const orderPayload = {
				bookingId: cfg.bookingId,
				amount: cfg.amount,
				paymentMethod: method,
				billingDetails,
			};
			if (method === "upi") {
				orderPayload.upiId = document.getElementById("upiId")?.value || "";
			} else if (method === "netbanking") {
				orderPayload.bankName =
					form.querySelector('input[name="bankName"]:checked')?.value || "HDFC Bank";
			}

			setStatusMessage("info", "Creating secure Razorpay payment order...");
			const createRes = await fetch("/api/v1/payments/create-order", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
				},
				body: JSON.stringify(orderPayload),
			});
			const createJson = await createRes.json().catch(() => ({}));
			if (!createRes.ok || !createJson?.data?.razorpayOrder) {
				throw new Error(createJson?.message || "Unable to initialize Razorpay order.");
			}

			if (typeof window.Razorpay !== "function") {
				throw new Error("Razorpay Checkout script failed to load. Please disable blockers or try again.");
			}

			const rpOrder = createJson.data.razorpayOrder;
			const options = {
				key: rpOrder.keyId,
				amount: rpOrder.amountPaise,
				currency: rpOrder.currency || "INR",
				name: "Wander-Lust",
				description: cfg.listingTitle || "Reservation Payment",
				order_id: rpOrder.orderId,
				prefill: {
					name: billingDetails.fullName || cfg.prefill?.name || "",
					email: billingDetails.email || cfg.prefill?.email || "",
					contact: cfg.prefill?.contact || "",
				},
				notes: { bookingId: cfg.bookingId },
				theme: { color: "#1b4332" },
				handler: async (response) => {
					try {
						setStatusMessage("info", "Verifying payment signature with server...");
						const verifyRes = await fetch("/api/v1/payments/razorpay/verify", {
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								Accept: "application/json",
								...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
							},
							body: JSON.stringify({
								bookingId: cfg.bookingId,
								razorpay_order_id: response.razorpay_order_id,
								razorpay_payment_id: response.razorpay_payment_id,
								razorpay_signature: response.razorpay_signature,
							}),
						});
						const verifyJson = await verifyRes.json().catch(() => ({}));
						if (!verifyRes.ok) {
							throw new Error(verifyJson?.message || "Payment verification failed.");
						}
						setStatusMessage("success", "Payment verified! Redirecting to tax invoice...");
						window.location.href =
							verifyJson?.data?.redirectUrl ||
							`/payments/receipt/${verifyJson?.data?.payment?._id || createJson.data._id}`;
					} catch (verifyErr) {
						setStatusMessage("danger", verifyErr.message || "Unable to confirm payment.");
						resetPayButton(btn, originalNodes);
					}
				},
				modal: {
					ondismiss: () => {
						setStatusMessage(
							"warning",
							"Checkout closed before completion. Checking for webhook confirmation...",
						);
						resetPayButton(btn, originalNodes);
						startBookingConfirmationPoll(cfg.bookingId, 4);
					},
				},
			};

			const rzp = new window.Razorpay(options);
			rzp.on("payment.failed", (resp) => {
				const reason = resp?.error?.description || "Payment authorization failed.";
				setStatusMessage("danger", `Payment failed: ${reason}`);
				resetPayButton(btn, originalNodes);
			});
			rzp.open();
		} catch (err) {
			setStatusMessage("danger", err.message || "Payment initiation failed.");
			resetPayButton(btn, originalNodes);
		}
	}

	document.addEventListener("DOMContentLoaded", () => {
		document.addEventListener("click", (e) => {
			const methodBtn = e.target.closest("[data-payment-method]");
			if (methodBtn) {
				selectPaymentMethod(methodBtn.dataset.paymentMethod);
				return;
			}
			const handleBtn = e.target.closest("[data-upi-handle]");
			if (handleBtn) {
				setUpiHandle(handleBtn.dataset.upiHandle);
			}
		});

		const cardInput = document.getElementById("cardNumber");
		if (cardInput) {
			cardInput.addEventListener("input", (e) => {
				const val = e.target.value.replace(/\D/g, "").substring(0, 16);
				e.target.value = val.match(/.{1,4}/g)?.join(" ") || val;

				const icon = document.getElementById("cardBrandIcon");
				if (icon) {
					if (val.startsWith("4")) icon.className = "fa-brands fa-cc-visa text-primary";
					else if (/^(5[1-5]|2[2-7])/.test(val)) icon.className = "fa-brands fa-cc-mastercard text-danger";
					else if (/^3[47]/.test(val)) icon.className = "fa-brands fa-cc-amex text-info";
					else icon.className = "fa-regular fa-credit-card";
				}
			});
		}

		const form = document.getElementById("checkoutPaymentForm");
		if (form) {
			const cfg = readCheckoutConfig();
			form.addEventListener("submit", (e) => {
				if (cfg && cfg.provider === "razorpay") {
					e.preventDefault();
					handleRazorpayCheckout(form, cfg);
					return;
				}
				const btn = document.getElementById("submitPaymentBtn");
				if (btn) {
					btn.disabled = true;
					btn.textContent = "Processing Payment...";
				}
			});
		}
	});
})();

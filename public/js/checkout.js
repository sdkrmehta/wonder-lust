(() => {
	function validatePostalForCountry(postal, country) {
		const clean = String(postal || "").trim();
		const c = String(country || "India").trim().toLowerCase();
		if (!clean) return false;
		if (c === "india") return /^[1-9]\d{5}$/.test(clean);
		if (c === "united states" || c === "usa" || c === "us") return /^\d{5}(?:-\d{4})?$/.test(clean);
		if (c === "united kingdom" || c === "uk") return /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i.test(clean);
		if (c === "canada") return /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/.test(clean);
		if (c === "australia") return /^\d{4}$/.test(clean);
		if (c === "singapore") return /^\d{6}$/.test(clean);
		if (c === "japan") return /^\d{3}-?\d{4}$/.test(clean);
		if (c === "netherlands") return /^\d{4}\s?[A-Za-z]{2}$/.test(clean);
		return /^[A-Za-z0-9][A-Za-z0-9\s-]{1,10}[A-Za-z0-9]$/.test(clean);
	}

	function setStatusAlert(alertEl, type, message) {
		if (!alertEl) return;
		alertEl.className = `alert alert-${type} mb-3 small`;
		alertEl.textContent = message;
	}

	document.addEventListener("DOMContentLoaded", () => {
		const countrySelect = document.getElementById("billingCountry");
		const postalInput = document.getElementById("billingPostalCode");
		const postalLabel = document.getElementById("billingPostalCodeLabel");
		const postalFeedback = document.getElementById("billingPostalCodeFeedback");

		const syncBillingPostalValidation = () => {
			if (!countrySelect || !postalInput) return;
			const country = countrySelect.value || "India";
			const isIndia = country.trim().toLowerCase() === "india";
			if (postalLabel) {
				postalLabel.textContent = isIndia ? "PIN Code" : "Postal Code";
			}
			postalInput.placeholder = isIndia
				? "6-digit PIN code (e.g. 400001)"
				: "Enter postal / ZIP code";

			if (postalInput.value) {
				const valid = validatePostalForCountry(postalInput.value, country);
				postalInput.setCustomValidity(
					valid
						? ""
						: isIndia
							? "PIN code for India must be a valid 6-digit PIN code"
							: "Please enter a valid postal code",
				);
				if (postalFeedback && !valid) {
					postalFeedback.textContent = isIndia
						? "PIN code for India must be a valid 6-digit PIN code (e.g. 400001)."
						: "Please enter a valid postal code for the selected country.";
				}
			} else {
				postalInput.setCustomValidity("");
			}
		};

		if (countrySelect && postalInput) {
			countrySelect.addEventListener("change", syncBillingPostalValidation);
			postalInput.addEventListener("input", syncBillingPostalValidation);
			syncBillingPostalValidation();
		}

		const form = document.getElementById("checkoutPaymentForm");
		if (!form) return;

		form.addEventListener("submit", async (e) => {
			e.preventDefault();
			e.stopPropagation();

			const btn = document.getElementById("submitPaymentBtn");
			const statusAlert = document.getElementById("paymentStatusAlert");

			syncBillingPostalValidation();
			if (!form.checkValidity()) {
				form.classList.add("was-validated");
				const firstInvalid = form.querySelector(":invalid");
				if (firstInvalid) {
					firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
					if (typeof firstInvalid.focus === "function") {
						firstInvalid.focus({ preventScroll: true });
					}
				}
				setStatusAlert(
					statusAlert,
					"danger",
					"Please complete all required billing fields accurately before proceeding to payment.",
				);
				return;
			}

			const origBtnHtml = btn ? btn.innerHTML : "";
			if (btn) {
				btn.disabled = true;
				btn.textContent = "Connecting to Razorpay...";
			}
			setStatusAlert(
				statusAlert,
				"info",
				"Creating secure Razorpay payment link and verifying reservation details...",
			);

			try {
				const val = (id) => (document.getElementById(id)?.value || "").trim();
				const csrfInput = form.querySelector('input[name="_csrf"]');
				const csrfMeta = document.querySelector('meta[name="csrf-token"]');
				const csrfToken =
					(csrfInput && csrfInput.value) ||
					(csrfMeta && csrfMeta.getAttribute("content")) ||
					"";

				const payload = {
					saveAsDefaultAddress: Boolean(
						document.getElementById("saveAsDefaultAddress")?.checked,
					),
					billingDetails: {
						fullName: val("billingFullName"),
						email: val("billingEmail"),
						addressLine1: val("billingAddressLine1"),
						addressLine2: val("billingAddressLine2"),
						landmark: val("billingLandmark"),
						city: val("billingCity"),
						state: val("billingState"),
						country: document.getElementById("billingCountry")?.value || "India",
						postalCode: val("billingPostalCode"),
					},
				};

				const response = await fetch(form.getAttribute("action"), {
					method: "POST",
					credentials: "same-origin",
					headers: {
						"Content-Type": "application/json",
						Accept: "application/json",
						...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
					},
					body: JSON.stringify(payload),
				});

				if (response.redirected && response.url) {
					window.location.assign(response.url);
					return;
				}

				let data = null;
				try {
					data = await response.json();
				} catch {
					data = null;
				}

				if (response.ok && data && data.redirectUrl) {
					setStatusAlert(
						statusAlert,
						"info",
						"Redirecting to Razorpay's hosted payment page...",
					);
					window.location.assign(data.redirectUrl);
					return;
				}

				const errorMsg =
					(data && data.message) ||
					"Unable to create Razorpay payment link right now. Please try again.";
				setStatusAlert(statusAlert, "danger", errorMsg);
				if (statusAlert) {
					statusAlert.scrollIntoView({ behavior: "smooth", block: "nearest" });
				}
			} catch (networkErr) {
				setStatusAlert(
					statusAlert,
					"danger",
					"Network error while contacting payment server. Please check your connection and try again.",
				);
			}

			if (btn) {
				btn.disabled = false;
				btn.innerHTML = origBtnHtml;
			}
		});
	});
})();

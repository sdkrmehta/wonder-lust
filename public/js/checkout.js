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
							? "PIN code for India must be 6 numeric digits"
							: "Please enter a valid postal code",
				);
				if (postalFeedback && !valid) {
					postalFeedback.textContent = isIndia
						? "PIN code for India must be exactly 6 numeric digits (e.g. 400001)."
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
		if (form) {
			form.addEventListener("submit", (e) => {
				syncBillingPostalValidation();
				if (!form.checkValidity()) {
					e.preventDefault();
					e.stopPropagation();
					form.classList.add("was-validated");
					return;
				}
				const btn = document.getElementById("submitPaymentBtn");
				const statusAlert = document.getElementById("paymentStatusAlert");
				if (statusAlert) {
					statusAlert.className = "alert alert-info mb-3 small";
					statusAlert.textContent = "Redirecting to Razorpay secure hosted payment page...";
				}
				if (btn) {
					btn.disabled = true;
					btn.textContent = "Redirecting to Secure Payment...";
				}
			});
		}
	});
})();

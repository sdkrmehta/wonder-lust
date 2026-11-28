(() => {
	function togglePasswordVisibility(fieldId, btn) {
		const inp = document.getElementById(fieldId);
		if (!inp || !btn) return;
		const icon = btn.querySelector("i") || document.createElement("i");
		if (inp.type === "password") {
			inp.type = "text";
			icon.className = "fa-regular fa-eye-slash";
		} else {
			inp.type = "password";
			icon.className = "fa-regular fa-eye";
		}
		if (!icon.parentNode) btn.replaceChildren(icon);
	}
	window.togglePasswordVisibility = togglePasswordVisibility;

	function previewAvatar(input) {
		if (input.files && input.files[0]) {
			const reader = new FileReader();
			reader.onload = (e) => {
				let preview = document.getElementById("avatarPreviewImg");
				const placeholder = document.getElementById("avatarPlaceholder");
				if (!preview && placeholder) {
					preview = document.createElement("img");
					preview.id = "avatarPreviewImg";
					preview.className = "rounded-circle shadow-sm border border-2 border-white";
					preview.style.width = "90px";
					preview.style.height = "90px";
					preview.style.objectFit = "cover";
					placeholder.parentNode.replaceChild(preview, placeholder);
				}
				if (preview) {
					preview.src = e.target.result;
				}
			};
			reader.readAsDataURL(input.files[0]);
		}
	}
	window.previewAvatar = previewAvatar;

	function validatePostalForCountryClient(postal, country) {
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

	function setupCountryPostalSync() {
		const countrySelects = document.querySelectorAll("select[data-postal-target]");
		countrySelects.forEach((selectEl) => {
			const targetId = selectEl.dataset.postalTarget;
			const postalInput = document.getElementById(targetId);
			if (!postalInput) return;

			const labelEl = document.getElementById("postalCodeLabel");
			const feedbackEl = document.getElementById("postalCodeFeedback");

			const syncUi = () => {
				const country = selectEl.value || "India";
				const isIndia = country.trim().toLowerCase() === "india";
				if (labelEl) {
					labelEl.textContent = isIndia ? "PIN Code" : "Postal Code";
				}
				postalInput.placeholder = isIndia
					? "6-digit PIN code (e.g. 400001)"
					: "Enter postal / ZIP code";

				if (postalInput.value) {
					const valid = validatePostalForCountryClient(postalInput.value, country);
					postalInput.setCustomValidity(
						valid
							? ""
							: isIndia
								? "PIN code for India must be 6 digits"
								: "Please enter a valid postal code",
					);
					if (feedbackEl && !valid) {
						feedbackEl.textContent = isIndia
							? "PIN code for India must be exactly 6 numeric digits (e.g. 400001)."
							: "Please enter a valid postal code for the selected country.";
					}
				} else {
					postalInput.setCustomValidity("");
				}
			};

			selectEl.addEventListener("change", syncUi);
			postalInput.addEventListener("input", syncUi);
			syncUi();
		});
	}

	function setupPasswordMatchValidation() {
		const pairs = [
			["password", "confirmPassword", "confirmPasswordFeedback"],
			["newPassword", "confirmPassword", "confirmNewPasswordFeedback"],
		];
		pairs.forEach(([pwId, confirmId, feedbackId]) => {
			const pw = document.getElementById(pwId);
			const confirm = document.getElementById(confirmId);
			if (!pw || !confirm || pw === confirm) return;
			const feedback = document.getElementById(feedbackId);

			const validate = () => {
				if (pwId === "password" && pw.value) {
					const strong = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,128}$/.test(pw.value);
					pw.setCustomValidity(
						strong
							? ""
							: "Password must be at least 8 characters and include uppercase, lowercase, and a number.",
					);
				}
				if (confirm.value && confirm.value !== pw.value) {
					confirm.setCustomValidity("Passwords do not match");
					if (feedback) feedback.textContent = "Password and confirm password must match.";
				} else {
					confirm.setCustomValidity("");
				}
			};
			pw.addEventListener("input", validate);
			confirm.addEventListener("input", validate);
		});
	}

	function setupOtpVerificationUi() {
		const otpInput = document.getElementById("otpInput");
		if (otpInput) {
			otpInput.addEventListener("input", () => {
				otpInput.value = otpInput.value.replace(/\D/g, "").slice(0, 6);
			});
		}

		const verifyEmailInput = document.getElementById("verifyEmailInput");
		const resendEmailHidden = document.getElementById("resendEmailHidden");
		if (verifyEmailInput && resendEmailHidden && !verifyEmailInput.readOnly) {
			verifyEmailInput.addEventListener("input", () => {
				resendEmailHidden.value = verifyEmailInput.value.trim();
			});
		}

		const resendBtn = document.getElementById("resendOtpBtn");
		const resendLabel = document.getElementById("resendBtnLabel");
		if (resendBtn && resendLabel) {
			let remaining = parseInt(resendBtn.dataset.cooldownSeconds || "0", 10) || 0;
			if (remaining > 0) {
				resendBtn.disabled = true;
				const timer = setInterval(() => {
					remaining -= 1;
					if (remaining <= 0) {
						clearInterval(timer);
						resendBtn.disabled = false;
						resendLabel.textContent = "Resend Verification Code";
					} else {
						resendLabel.textContent = `Resend OTP in ${remaining}s`;
					}
				}, 1000);
			}
		}
	}

	document.addEventListener("DOMContentLoaded", () => {
		document.addEventListener("click", (e) => {
			const toggleBtn = e.target.closest("[data-toggle-password]");
			if (toggleBtn) {
				togglePasswordVisibility(toggleBtn.dataset.togglePassword, toggleBtn);
			}
		});

		const avatarInput = document.getElementById("avatarInput");
		if (avatarInput) {
			avatarInput.addEventListener("change", () => previewAvatar(avatarInput));
		}

		setupCountryPostalSync();
		setupPasswordMatchValidation();
		setupOtpVerificationUi();
	});
})();

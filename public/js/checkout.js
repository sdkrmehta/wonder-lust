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
			form.addEventListener("submit", () => {
				const btn = document.getElementById("submitPaymentBtn");
				if (btn) {
					btn.disabled = true;
					btn.textContent = "Processing Payment...";
				}
			});
		}
	});
})();

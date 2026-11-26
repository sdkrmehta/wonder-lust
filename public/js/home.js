(() => {
	function filterDestinations(country, btnEl) {
		document.querySelectorAll(".country-pill-btn").forEach((t) => t.classList.remove("active"));
		if (btnEl) btnEl.classList.add("active");

		document.querySelectorAll(".destination-card-col").forEach((col) => {
			const c = col.getAttribute("data-country");
			col.style.display = country === "All" || c === country ? "" : "none";
		});
	}
	window.filterDestinations = filterDestinations;

	document.addEventListener("DOMContentLoaded", () => {
		const navbar = document.getElementById("mainNavbar");
		function updateNavbarState() {
			if (!navbar) return;
			if (window.scrollY > 40) navbar.classList.add("navbar-scrolled");
			else navbar.classList.remove("navbar-scrolled");
		}
		window.addEventListener("scroll", updateNavbarState);
		updateNavbarState();

		const checkIn = document.getElementById("heroCheckIn");
		const checkOut = document.getElementById("heroCheckOut");
		const dateAlert = document.getElementById("heroDateAlert");
		const searchForm = document.getElementById("heroSearchForm");

		if (checkIn && checkOut) {
			const today = new Date().toISOString().split("T")[0];
			checkIn.min = today;

			checkIn.addEventListener("change", () => {
				if (checkIn.value) {
					const nextDay = new Date(checkIn.value);
					nextDay.setDate(nextDay.getDate() + 1);
					checkOut.min = nextDay.toISOString().split("T")[0];
					if (checkOut.value && checkOut.value <= checkIn.value) {
						checkOut.value = nextDay.toISOString().split("T")[0];
					}
				}
				if (dateAlert) dateAlert.classList.add("d-none");
			});

			checkOut.addEventListener("change", () => {
				if (checkIn.value && checkOut.value && checkOut.value <= checkIn.value) {
					if (dateAlert) dateAlert.classList.remove("d-none");
				} else if (dateAlert) {
					dateAlert.classList.add("d-none");
				}
			});

			if (searchForm) {
				searchForm.addEventListener("submit", (e) => {
					if (checkIn.value && checkOut.value && checkOut.value <= checkIn.value) {
						e.preventDefault();
						if (dateAlert) dateAlert.classList.remove("d-none");
					}
				});
			}
		}

		const nlForm = document.getElementById("newsletterForm");
		const nlEmail = document.getElementById("newsletterEmail");
		const nlSuccess = document.getElementById("newsletterSuccess");
		const nlError = document.getElementById("newsletterError");

		if (nlForm && nlEmail) {
			nlForm.addEventListener("submit", async (e) => {
				e.preventDefault();
				if (nlSuccess) nlSuccess.classList.add("d-none");
				if (nlError) nlError.classList.add("d-none");

				const val = nlEmail.value.trim();
				const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
				if (!emailRegex.test(val)) {
					if (nlError) nlError.classList.remove("d-none");
					return;
				}

				try {
					const csrfMeta = document.querySelector('meta[name="csrf-token"]');
					const csrfToken = csrfMeta ? csrfMeta.getAttribute("content") || "" : "";
					const res = await fetch("/newsletter", {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
						},
						body: JSON.stringify({ email: val }),
					});
					const data = await res.json();
					if (res.ok && data.status === "success") {
						if (nlSuccess) {
							nlSuccess.textContent = data.message || "Thank you for subscribing!";
							nlSuccess.classList.remove("d-none");
						}
						nlEmail.value = "";
					} else if (nlError) {
						nlError.textContent = data.message || "Subscription could not be processed.";
						nlError.classList.remove("d-none");
					}
				} catch {
					if (nlError) {
						nlError.textContent = "Unable to submit right now. Please try again.";
						nlError.classList.remove("d-none");
					}
				}
			});
		}

		document.addEventListener("click", (e) => {
			const pill = e.target.closest("[data-filter-country]");
			if (pill) {
				filterDestinations(pill.dataset.filterCountry, pill);
			}
		});
	});
})();

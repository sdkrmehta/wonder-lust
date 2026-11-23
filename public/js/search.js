// Wander-Lust Airbnb-Style Unified Search Engine & Scroll Animation Controller
(() => {
	"use strict";

	function escapeHtml(str) {
		if (!str) return "";
		return str
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#039;");
	}

	function formatDateShort(dateStr) {
		if (!dateStr) return "";
		try {
			const parts = dateStr.split("-");
			if (parts.length === 3) {
				const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
				return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
			}
			return dateStr;
		} catch (e) {
			return dateStr;
		}
	}

	document.addEventListener("DOMContentLoaded", () => {
		const header = document.getElementById("mainNavbar");
		const expandedContainers = document.querySelectorAll(".expanded-search-container");
		const compactPill = document.getElementById("headerCompactSearch");
		const searchOverlay = document.getElementById("headerSearchOverlay");
		const searchBackdrop = document.getElementById("headerSearchBackdrop");
		const closeOverlayBtn = document.getElementById("closeHeaderSearchBtn");
		const allSearchForms = document.querySelectorAll(".wanderlust-search-form");

		// ----------------------------------------------------------------------
		// 1. Initial State from Form Inputs / URL Parameters
		// ----------------------------------------------------------------------
		function getActiveSearchState() {
			// Find primary active form or any available search form
			const refForm =
				document.getElementById("heroSearchForm") ||
				document.getElementById("listingsSearchForm") ||
				document.getElementById("headerExpandedSearchForm") ||
				document.querySelector(".wanderlust-search-form");

			if (!refForm) {
				return { q: "", checkIn: "", checkOut: "", bedrooms: "1", guests: "2" };
			}

			const qInput = refForm.querySelector(".destination-input");
			const inInput = refForm.querySelector(".checkin-input");
			const outInput = refForm.querySelector(".checkout-input");
			const roomsInput = refForm.querySelector(".rooms-input");
			const guestsInput = refForm.querySelector(".guests-input");

			return {
				q: qInput ? qInput.value.trim() : "",
				checkIn: inInput ? inInput.value : "",
				checkOut: outInput ? outInput.value : "",
				bedrooms: roomsInput ? roomsInput.value : "1",
				guests: guestsInput ? guestsInput.value : "2",
			};
		}

		// ----------------------------------------------------------------------
		// 2. Compact Search Pill Summary Updater (Where, When, Who)
		// ----------------------------------------------------------------------
		function updateCompactPillDisplay(state) {
			const s = state || getActiveSearchState();

			const whereEl = document.getElementById("compactWhereText");
			const whenEl = document.getElementById("compactWhenText");
			const whoEl = document.getElementById("compactWhoText");
			const mobileSearchText = document.getElementById("mobileSearchText");

			// WHERE section
			if (whereEl) {
				whereEl.textContent = s.q ? s.q : "Where to?";
			}
			if (mobileSearchText) {
				mobileSearchText.textContent = s.q ? s.q : "Where to?";
			}

			// WHEN section
			if (whenEl) {
				if (s.checkIn && s.checkOut) {
					whenEl.textContent = `${formatDateShort(s.checkIn)} – ${formatDateShort(s.checkOut)}`;
					whenEl.classList.remove("text-muted");
				} else if (s.checkIn) {
					whenEl.textContent = `From ${formatDateShort(s.checkIn)}`;
					whenEl.classList.remove("text-muted");
				} else {
					whenEl.textContent = "Any week";
					whenEl.classList.add("text-muted");
				}
			}

			// WHO section
			if (whoEl) {
				const gVal = parseInt(s.guests, 10);
				const rVal = parseInt(s.bedrooms, 10);
				const parts = [];

				if (!isNaN(gVal) && gVal > 0) {
					parts.push(`${gVal} guest${gVal > 1 ? "s" : ""}`);
				}
				if (!isNaN(rVal) && rVal > 1) {
					parts.push(`${rVal} rooms`);
				}

				if (parts.length > 0) {
					whoEl.textContent = parts.join(", ");
					whoEl.classList.remove("text-muted");
				} else {
					whoEl.textContent = "Add guests";
					whoEl.classList.add("text-muted");
				}
			}
		}

		// ----------------------------------------------------------------------
		// 3. Sync Values Across All Search Forms (Hero, Listings, Header, Mobile)
		// ----------------------------------------------------------------------
		function syncAllSearchForms(sourceForm, fieldName, value) {
			allSearchForms.forEach((form) => {
				if (form === sourceForm) return;

				if (fieldName === "q") {
					const el = form.querySelector(".destination-input");
					if (el && el.value !== value) el.value = value;
				} else if (fieldName === "checkIn") {
					const el = form.querySelector(".checkin-input");
					if (el && el.value !== value) el.value = value;
				} else if (fieldName === "checkOut") {
					const el = form.querySelector(".checkout-input");
					if (el && el.value !== value) el.value = value;
				} else if (fieldName === "bedrooms") {
					const el = form.querySelector(".rooms-input");
					if (el && el.value !== value) el.value = value;
				} else if (fieldName === "guests") {
					const el = form.querySelector(".guests-input");
					if (el && el.value !== value) el.value = value;
				}
			});

			updateCompactPillDisplay();
		}

		// ----------------------------------------------------------------------
		// 4. Form Date Validation & Dynamic Min Date Configuration
		// ----------------------------------------------------------------------
		const todayIso = new Date().toISOString().split("T")[0];

		allSearchForms.forEach((form) => {
			const qInp = form.querySelector(".destination-input");
			const ciInp = form.querySelector(".checkin-input");
			const coInp = form.querySelector(".checkout-input");
			const roomsSel = form.querySelector(".rooms-input");
			const guestsSel = form.querySelector(".guests-input");
			const dateAlert = form.querySelector(".search-date-alert");

			// Set today as minimum check-in date
			if (ciInp && !ciInp.getAttribute("min")) {
				ciInp.setAttribute("min", todayIso);
			}

			// When Check-in changes, adjust minimum Check-out date
			if (ciInp && coInp) {
				if (ciInp.value) {
					coInp.setAttribute("min", ciInp.value);
				}

				ciInp.addEventListener("change", () => {
					const val = ciInp.value;
					if (val) {
						coInp.setAttribute("min", val);
						if (coInp.value && coInp.value < val) {
							coInp.value = val;
							syncAllSearchForms(form, "checkOut", val);
						}
					}
					if (dateAlert && coInp.value && coInp.value >= val) {
						dateAlert.classList.add("d-none");
					}
					syncAllSearchForms(form, "checkIn", val);
				});

				coInp.addEventListener("change", () => {
					const val = coInp.value;
					if (ciInp.value && val && val < ciInp.value) {
						if (dateAlert) dateAlert.classList.remove("d-none");
					} else {
						if (dateAlert) dateAlert.classList.add("d-none");
					}
					syncAllSearchForms(form, "checkOut", val);
				});
			}

			// Input change listeners for instant synchronization
			if (qInp) {
				qInp.addEventListener("input", () => {
					syncAllSearchForms(form, "q", qInp.value);
				});
			}

			if (roomsSel) {
				roomsSel.addEventListener("change", () => {
					syncAllSearchForms(form, "bedrooms", roomsSel.value);
				});
			}

			if (guestsSel) {
				guestsSel.addEventListener("change", () => {
					syncAllSearchForms(form, "guests", guestsSel.value);
				});
			}

			// Form submission validation guard
			form.addEventListener("submit", (e) => {
				if (ciInp && coInp && ciInp.value && coInp.value) {
					if (coInp.value < ciInp.value) {
						e.preventDefault();
						e.stopPropagation();
						if (dateAlert) {
							dateAlert.classList.remove("d-none");
							dateAlert.scrollIntoView({ behavior: "smooth", block: "nearest" });
						}
						return false;
					}
				}
				if (dateAlert) dateAlert.classList.add("d-none");
				closeSearchOverlay();
			});
		});

		// ----------------------------------------------------------------------
		// 5. Autocomplete Destination Suggestions with Keyboard Navigation
		// ----------------------------------------------------------------------
		const searchInputs = document.querySelectorAll(".search-inp");

		searchInputs.forEach((input) => {
			const form = input.closest("form");
			if (!form) return;

			let suggestionsBox = form.querySelector(".search-suggestions-dropdown");
			if (!suggestionsBox) {
				suggestionsBox = document.createElement("div");
				suggestionsBox.className = "search-suggestions-dropdown shadow";
				suggestionsBox.style.display = "none";
				form.style.position = "relative";
				form.appendChild(suggestionsBox);
			}

			let debounceTimer;
			let activeItemIndex = -1;

			input.addEventListener("input", () => {
				const query = input.value.trim();
				clearTimeout(debounceTimer);
				activeItemIndex = -1;

				if (query.length < 2) {
					suggestionsBox.style.display = "none";
					suggestionsBox.innerHTML = "";
					return;
				}

				// Show loading feedback
				suggestionsBox.style.display = "block";
				suggestionsBox.innerHTML = `
					<div class="p-3 text-muted text-center" style="font-size: 0.86rem;">
						<i class="fa-solid fa-spinner fa-spin me-2 text-warning"></i> Searching destinations...
					</div>
				`;

				debounceTimer = setTimeout(async () => {
					try {
						const res = await fetch(`/listings/suggestions?q=${encodeURIComponent(query)}`);
						if (!res.ok) throw new Error("Search suggestions failed");
						const json = await res.json();
						const suggestions = json.data || [];

						if (suggestions.length === 0) {
							suggestionsBox.innerHTML = `
								<div class="p-3 text-muted text-center" style="font-size: 0.86rem;">
									<i class="fa-solid fa-location-dot me-2 text-secondary"></i>No matching destinations found
								</div>
							`;
							return;
						}

						suggestionsBox.innerHTML = suggestions
							.map((item, idx) => {
								const icon =
									item.type === "location"
										? "fa-location-dot text-danger"
										: item.type === "country"
											? "fa-earth-americas text-primary"
											: "fa-hotel text-success";
								return `
									<div class="suggestion-item p-2 px-3 d-flex align-items-center" data-index="${idx}" data-query="${escapeHtml(item.query)}" role="button" tabindex="0" style="cursor: pointer; border-bottom: 1px solid #f2f2f2;">
										<i class="fa-solid ${icon} me-3" style="width: 16px;"></i>
										<span class="text-dark fw-medium" style="font-size: 0.9rem;">${escapeHtml(item.text)}</span>
									</div>
								`;
							})
							.join("");

						// Attach click listeners to suggestions
						suggestionsBox.querySelectorAll(".suggestion-item").forEach((item) => {
							item.addEventListener("click", () => {
								const selectedQuery = item.getAttribute("data-query");
								input.value = selectedQuery;
								syncAllSearchForms(form, "q", selectedQuery);
								suggestionsBox.style.display = "none";

								// Focus next logical input: check-in date
								const ci = form.querySelector(".checkin-input");
								if (ci) {
									ci.focus();
								} else {
									form.submit();
								}
							});
						});
					} catch (err) {
						suggestionsBox.innerHTML = `
							<div class="p-3 text-danger text-center" style="font-size: 0.86rem;">
								<i class="fa-solid fa-circle-exclamation me-1"></i> Error loading suggestions
							</div>
						`;
					}
				}, 220);
			});

			// Keyboard Navigation within Suggestions
			input.addEventListener("keydown", (e) => {
				const items = suggestionsBox.querySelectorAll(".suggestion-item");
				if (suggestionsBox.style.display === "block" && items.length > 0) {
					if (e.key === "ArrowDown") {
						e.preventDefault();
						activeItemIndex = (activeItemIndex + 1) % items.length;
						highlightSuggestion(items, activeItemIndex);
					} else if (e.key === "ArrowUp") {
						e.preventDefault();
						activeItemIndex = (activeItemIndex - 1 + items.length) % items.length;
						highlightSuggestion(items, activeItemIndex);
					} else if (e.key === "Enter" && activeItemIndex >= 0) {
						e.preventDefault();
						items[activeItemIndex].click();
					} else if (e.key === "Escape") {
						suggestionsBox.style.display = "none";
					}
				}
			});

			function highlightSuggestion(items, index) {
				items.forEach((it, i) => {
					if (i === index) {
						it.style.backgroundColor = "#FFF3D6";
						it.scrollIntoView({ block: "nearest" });
					} else {
						it.style.backgroundColor = "transparent";
					}
				});
			}

			// Dismiss dropdown on outside click
			document.addEventListener("click", (e) => {
				if (!form.contains(e.target)) {
					suggestionsBox.style.display = "none";
				}
			});
		});

		// ----------------------------------------------------------------------
		// 6. Airbnb-Style Scroll-Responsive Search Docking Transition
		// ----------------------------------------------------------------------
		let lastScrollY = window.scrollY || window.pageYOffset;
		let ticking = false;

		function handleScrollTransition() {
			const scrollY = window.scrollY || window.pageYOffset;
			const isHomeNav = header && header.classList.contains("navbar-home-transparent");
			const primaryExpanded = document.querySelector(".expanded-search-container");
			const scrollDiff = scrollY - lastScrollY;
			const isScrollingDown = scrollDiff > 2;
			const isScrollingUp = scrollDiff < -2;

			// Check if user has scrolled past the expanded search bar or header threshold
			let isPastSearch = false;
			if (primaryExpanded) {
				const rect = primaryExpanded.getBoundingClientRect();
				isPastSearch = rect.top <= 75;
			} else {
				isPastSearch = scrollY > 75;
			}

			// State A: Near or at the top of the page (within top 80px)
			if (scrollY <= 80) {
				if (header) {
					// Make navigation options (Home, Explore Destinations, Hotels, Experiences, About Us, Contact) visible
					header.classList.remove("search-docked");
					if (isHomeNav) {
						header.classList.remove("navbar-scrolled");
					}
				}
				if (primaryExpanded) {
					primaryExpanded.classList.remove("search-bar-scrolled-out");
				}
				closeSearchOverlay();
			}
			// State B: Scrolled down past search bar AND scrolling DOWN
			else if (isPastSearch && isScrollingDown) {
				if (header) {
					header.classList.add("search-docked");
					if (isHomeNav) {
						header.classList.add("navbar-scrolled");
					}
				}
				if (primaryExpanded) {
					primaryExpanded.classList.add("search-bar-scrolled-out");
				}
			}
			// State C: User is scrolling UP -> IMMEDIATELY REVEAL navigation options
			else if (isScrollingUp) {
				if (header) {
					// Make navigation options (Home, Explore Destinations, Hotels, Experiences, About Us, Contact) visible
					header.classList.remove("search-docked");
					if (isHomeNav) {
						// Keep dark navy background for readability over content
						header.classList.add("navbar-scrolled");
					}
				}
				closeSearchOverlay();
				// If scrolled back up to the expanded search bar's position, restore it
				if (primaryExpanded && !isPastSearch) {
					primaryExpanded.classList.remove("search-bar-scrolled-out");
				}
			}

			// Header background tint guard over content
			if (isHomeNav) {
				if (scrollY > 30) {
					header.classList.add("navbar-scrolled");
				} else if (scrollY <= 30) {
					header.classList.remove("navbar-scrolled");
				}
			}

			lastScrollY = Math.max(0, scrollY);
			ticking = false;
		}

		window.addEventListener(
			"scroll",
			() => {
				if (!ticking) {
					window.requestAnimationFrame(handleScrollTransition);
					ticking = true;
				}
			},
			{ passive: true },
		);

		// IntersectionObserver for expanded search bar visibility awareness
		if ("IntersectionObserver" in window) {
			expandedContainers.forEach((container) => {
				const observer = new IntersectionObserver(
					(entries) => {
						entries.forEach((entry) => {
							if (entry.isIntersecting && entry.boundingClientRect.top >= 50) {
								if (header && window.scrollY <= 100) {
									header.classList.remove("search-docked");
								}
								container.classList.remove("search-bar-scrolled-out");
							}
						});
					},
					{
						threshold: [0, 0.2, 0.8],
						rootMargin: "-60px 0px 0px 0px",
					},
				);
				observer.observe(container);
			});
		}

		// Initial evaluation on DOM load
		handleScrollTransition();

		// ----------------------------------------------------------------------
		// 7. Compact Search Pill Click Interaction (Reopens Expanded Overlay)
		// ----------------------------------------------------------------------
		function openSearchOverlay() {
			if (!searchOverlay) return;
			searchOverlay.classList.add("active");
			if (searchBackdrop) searchBackdrop.classList.remove("d-none");

			// Focus the destination input in the dropdown form
			const overlayInput = searchOverlay.querySelector(".destination-input");
			if (overlayInput) {
				setTimeout(() => overlayInput.focus(), 150);
			}
		}

		function closeSearchOverlay() {
			if (searchOverlay) searchOverlay.classList.remove("active");
			if (searchBackdrop) searchBackdrop.classList.add("d-none");
		}

		if (compactPill) {
			compactPill.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();

				// If user is scrolled down, open the header search dropdown
				if (searchOverlay && searchOverlay.classList.contains("active")) {
					closeSearchOverlay();
				} else {
					openSearchOverlay();
				}
			});

			compactPill.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					openSearchOverlay();
				}
			});
		}

		if (closeOverlayBtn) {
			closeOverlayBtn.addEventListener("click", closeSearchOverlay);
		}

		if (searchBackdrop) {
			searchBackdrop.addEventListener("click", closeSearchOverlay);
		}

		// Close search overlay on Escape key
		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				closeSearchOverlay();
			}
		});

		// ----------------------------------------------------------------------
		// 8. Initialize Compact Pill Display from Initial Input Values
		// ----------------------------------------------------------------------
		updateCompactPillDisplay();
	});
})();

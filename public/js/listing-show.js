(() => {
	function escHtmlShow(str) {
		return String(str ?? "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}

	function isSafeDisplayUrl(url) {
		if (typeof url !== "string") return false;
		const t = url.trim();
		return /^https?:\/\//i.test(t) || (/^\/[^\/]/.test(t) && !t.includes("\\"));
	}

	function getPageData() {
		const el = document.getElementById("listingShowData");
		if (!el) return {};
		try {
			return JSON.parse(el.textContent || "{}");
		} catch {
			return {};
		}
	}

	function switchHeroImage(thumbEl, newUrl) {
		if (!isSafeDisplayUrl(newUrl)) return;
		const heroImg = document.getElementById("mainHeroImg");
		if (heroImg) {
			heroImg.style.opacity = "0.4";
			heroImg.src = newUrl;
			heroImg.onload = () => {
				heroImg.style.opacity = "1";
			};
		}
		document.querySelectorAll(".gallery-thumb").forEach((t) => t.classList.remove("active"));
		if (thumbEl) thumbEl.classList.add("active");
	}
	window.switchHeroImage = switchHeroImage;

	function openLightbox(index) {
		const data = getPageData();
		const gallery = Array.isArray(data.galleryImages) ? data.galleryImages : [];
		if (gallery[index]) {
			const activeImg = document.getElementById("lightboxActiveImg");
			if (activeImg && isSafeDisplayUrl(gallery[index].url)) {
				activeImg.src = gallery[index].url;
			}
			const thumbs = document.querySelectorAll(".lightbox-strip-thumb");
			thumbs.forEach((t, i) => {
				if (i === index) {
					t.classList.add("border-light");
					t.classList.remove("border-transparent");
					t.style.opacity = "1";
				} else {
					t.classList.remove("border-light");
					t.classList.add("border-transparent");
					t.style.opacity = "0.7";
				}
			});
		}
		const modalEl = document.getElementById("photoLightboxModal");
		if (modalEl && typeof bootstrap !== "undefined") {
			const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
			modal.show();
		}
	}
	window.openLightbox = openLightbox;

	function setLightboxImg(url, thumbEl) {
		if (!isSafeDisplayUrl(url)) return;
		const activeImg = document.getElementById("lightboxActiveImg");
		if (activeImg) activeImg.src = url;
		document.querySelectorAll(".lightbox-strip-thumb").forEach((t) => {
			t.classList.remove("border-light");
			t.classList.add("border-transparent");
			t.style.opacity = "0.7";
		});
		if (thumbEl) {
			thumbEl.classList.add("border-light");
			thumbEl.classList.remove("border-transparent");
			thumbEl.style.opacity = "1";
		}
	}
	window.setLightboxImg = setLightboxImg;

	function hideBookingToast() {
		const toastPopup = document.getElementById("bookingToastPopup");
		if (toastPopup) toastPopup.classList.remove("show");
	}
	window.hideBookingToast = hideBookingToast;

	document.addEventListener("click", (e) => {
		const switchTarget = e.target.closest('[data-action="switchHeroImage"]');
		if (switchTarget) {
			switchHeroImage(switchTarget, switchTarget.dataset.imgUrl);
			return;
		}
		const lightboxTrigger = e.target.closest("[data-lightbox-index]");
		if (lightboxTrigger) {
			const idx = parseInt(lightboxTrigger.dataset.lightboxIndex, 10) || 0;
			openLightbox(idx);
			return;
		}
		const stripTrigger = e.target.closest('[data-action="setLightboxImg"]');
		if (stripTrigger) {
			setLightboxImg(stripTrigger.dataset.imgUrl, stripTrigger);
			return;
		}
		const toastClose = e.target.closest('[data-action="hideBookingToast"]');
		if (toastClose) {
			hideBookingToast();
			return;
		}
		const scrollTrigger = e.target.closest("[data-scroll-target]");
		if (scrollTrigger) {
			const targetEl = document.querySelector(scrollTrigger.dataset.scrollTarget);
			if (targetEl) targetEl.scrollIntoView({ behavior: "smooth" });
		}
	});

	// Interactive Leaflet Map
	document.addEventListener("DOMContentLoaded", async () => {
		const data = getPageData();
		const mapEl = document.getElementById("map");
		if (!mapEl || typeof L === "undefined") return;

		try {
			const addressTitle = data.title || "";
			const addressLocation = data.location || "";
			const addressCountry = data.country || "";
			const nightPrice = Number(data.price) || 0;
			const fullAddress = [addressLocation, addressCountry].filter(Boolean).join(", ");
			const isDelhiAddress =
				addressLocation.toLowerCase().includes("delhi") ||
				addressCountry.toLowerCase().includes("delhi");
			const rawCoords = Array.isArray(data.coords) && data.coords.length >= 2 ? data.coords : null;

			const isDefaultPlaceholder =
				rawCoords &&
				Math.abs(Number(rawCoords[0]) - 77.209) < 0.005 &&
				Math.abs(Number(rawCoords[1]) - 28.6139) < 0.005 &&
				!isDelhiAddress;

			let lng = rawCoords && !isDefaultPlaceholder ? Number(rawCoords[0]) : 0.0;
			let lat = rawCoords && !isDefaultPlaceholder ? Number(rawCoords[1]) : 20.0;
			const initialZoom = lat === 20.0 && lng === 0.0 ? 2 : 13;

			const createMap =
				typeof window.__wonderlustCreateMap === "function"
					? window.__wonderlustCreateMap
					: (id, opts) => L.map(id, opts);
			const map = createMap("map", { scrollWheelZoom: false }).setView([lat, lng], initialZoom);
			L.tileLayer(
				"https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
				{
					attribution:
						'Tiles &copy; <a href="https://www.esri.com/" target="_blank">Esri</a> &mdash; Source: Esri, USGS, TomTom',
					maxZoom: 19,
				},
			).addTo(map);

			const customPin = L.divIcon({
				html: `
					<div style="background:#1D3557;color:#ffffff;width:36px;height:36px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(16,42,67,0.4);border:2px solid #ffffff;">
						<i class="fa-solid fa-hotel" style="transform:rotate(45deg);font-size:14px;"></i>
					</div>
				`,
				className: "custom-map-pin",
				iconSize: [36, 36],
				iconAnchor: [18, 36],
				popupAnchor: [0, -36],
			});

			const popupContent = `
				<div style="min-width: 170px;">
					<div class="fw-bold mb-1" style="color: #102A43; font-size: 0.95rem;">${escHtmlShow(addressTitle)}</div>
					<div class="text-muted small mb-1"><i class="fa-solid fa-location-dot text-danger me-1"></i>${escHtmlShow(addressLocation)}, ${escHtmlShow(addressCountry)}</div>
					<div class="mt-1 pt-1 border-top d-flex justify-content-between align-items-center">
						<span class="fw-bold" style="color: #1D3557;">&#x20B9;${nightPrice.toLocaleString("en-IN")} <span class="fw-normal text-muted small">/ night</span></span>
					</div>
				</div>
			`;

			const marker = L.marker([lat, lng], { icon: customPin }).addTo(map).bindPopup(popupContent);

			async function geocodeAddressDynamic(query) {
				if (!query || query.trim().length === 0) return null;
				try {
					const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
					const nomRes = await fetch(nomUrl, { headers: { "Accept-Language": "en" } });
					if (nomRes.ok) {
						const nomData = await nomRes.json();
						if (nomData && nomData.length > 0) {
							return { lat: parseFloat(nomData[0].lat), lng: parseFloat(nomData[0].lon) };
						}
					}
				} catch {
					// Ignore geocoder failure
				}
				try {
					const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1`;
					const photonRes = await fetch(photonUrl);
					if (photonRes.ok) {
						const photonData = await photonRes.json();
						if (photonData && photonData.features && photonData.features.length > 0) {
							const pt = photonData.features[0].geometry.coordinates;
							return { lat: pt[1], lng: pt[0] };
						}
					}
				} catch {
					// Ignore geocoder failure
				}
				return null;
			}

			if (isDefaultPlaceholder || !rawCoords) {
				let resolved = await geocodeAddressDynamic(fullAddress);
				if (!resolved && addressLocation) resolved = await geocodeAddressDynamic(addressLocation);
				if (!resolved && addressCountry) resolved = await geocodeAddressDynamic(addressCountry);
				if (resolved) {
					map.setView([resolved.lat, resolved.lng], 13);
					marker.setLatLng([resolved.lat, resolved.lng]);
				}
			}
			marker.openPopup();
		} catch {
			// Ignore fallback error
		}
	});

	// Interactive Availability Calendar & Booking Price Calculator
	document.addEventListener("DOMContentLoaded", async () => {
		const data = getPageData();
		const checkInInput = document.getElementById("checkInInput");
		const checkOutInput = document.getElementById("checkOutInput");
		const priceContainer = document.getElementById("priceCalculationContainer");
		const conflictAlert = document.getElementById("bookingConflictAlert");
		const reserveBtn = document.getElementById("reserveSubmitBtn");
		const gridContainer = document.getElementById("calendarGridContainer");
		const statusPill = document.getElementById("bookingStatusPill");
		const instructionText = document.getElementById("calendarInstructionText");
		const staySummary = document.getElementById("selectedStaySummary");
		const toastPopup = document.getElementById("bookingToastPopup");
		const toastMsg = document.getElementById("bookingToastMsg");

		if (!checkInInput || !checkOutInput || !data.id) return;

		function formatYMD(d) {
			const y = d.getFullYear();
			const m = String(d.getMonth() + 1).padStart(2, "0");
			const day = String(d.getDate()).padStart(2, "0");
			return `${y}-${m}-${day}`;
		}

		function formatDisplayDate(d) {
			return d.toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" });
		}

		const today = new Date();
		today.setHours(0, 0, 0, 0);
		checkInInput.min = formatYMD(today);

		let bookedIntervals = [];
		try {
			const res = await fetch(`/listings/${encodeURIComponent(data.id)}/booked-dates`);
			const json = await res.json();
			bookedIntervals = (json && json.data) || [];
		} catch {
			bookedIntervals = [];
		}

		let calendarStartMonth = new Date(today.getFullYear(), today.getMonth(), 1);
		let selectedCheckInDate = null;
		let selectedCheckOutDate = null;
		let toastTimer = null;

		function showBookingToast(message) {
			if (!toastPopup || !toastMsg) return;
			toastMsg.textContent = message;
			toastPopup.classList.add("show");
			if (toastTimer) clearTimeout(toastTimer);
			toastTimer = setTimeout(() => toastPopup.classList.remove("show"), 4500);
		}

		function isDateInPast(d) {
			const check = new Date(d);
			check.setHours(0, 0, 0, 0);
			return check < today;
		}

		function isDateBooked(d) {
			const checkMidday = new Date(d);
			checkMidday.setHours(12, 0, 0, 0);
			return bookedIntervals.some((b) => {
				const bStart = new Date(b.checkIn);
				const bEnd = new Date(b.checkOut);
				return checkMidday >= bStart && checkMidday < bEnd;
			});
		}

		function doesRangeContainBooked(startD, endD) {
			const cur = new Date(startD);
			cur.setHours(12, 0, 0, 0);
			const endCheck = new Date(endD);
			endCheck.setHours(12, 0, 0, 0);
			while (cur < endCheck) {
				if (isDateBooked(cur)) return true;
				cur.setDate(cur.getDate() + 1);
			}
			return false;
		}

		function renderCalendar() {
			if (!gridContainer) return;
			gridContainer.innerHTML = "";

			for (let mOffset = 0; mOffset < 2; mOffset++) {
				const monthDate = new Date(calendarStartMonth.getFullYear(), calendarStartMonth.getMonth() + mOffset, 1);
				const monthName = monthDate.toLocaleDateString("en-US", { month: "long" });
				const year = monthDate.getFullYear();

				const monthBlock = document.createElement("div");
				monthBlock.className = "calendar-month-block";

				const header = document.createElement("div");
				header.className = "d-flex justify-content-between align-items-center mb-2 px-1";
				const titleSpan = document.createElement("span");
				titleSpan.className = "fw-bold fs-6 text-dark";
				titleSpan.textContent = `${monthName} ${year}`;
				header.appendChild(titleSpan);
				monthBlock.appendChild(header);

				const table = document.createElement("table");
				table.className = "calendar-month-table";
				table.innerHTML = `<thead><tr><th>Su</th><th>Mo</th><th>Tu</th><th>We</th><th>Th</th><th>Fr</th><th>Sa</th></tr></thead>`;

				const tbody = document.createElement("tbody");
				const firstDayOfWeek = monthDate.getDay();
				const daysInMonth = new Date(year, monthDate.getMonth() + 1, 0).getDate();

				let dayCounter = 1;
				for (let row = 0; row < 6; row++) {
					if (dayCounter > daysInMonth) break;
					const tr = document.createElement("tr");

					for (let col = 0; col < 7; col++) {
						const td = document.createElement("td");
						td.className = "calendar-day-cell";

						if ((row === 0 && col < firstDayOfWeek) || dayCounter > daysInMonth) {
							td.className += " calendar-day-empty";
						} else {
							const currentDayNum = dayCounter;
							const cellDate = new Date(year, monthDate.getMonth(), currentDayNum);
							const ymd = formatYMD(cellDate);
							const isPast = isDateInPast(cellDate);
							const isBooked = isDateBooked(cellDate);
							const isStart = selectedCheckInDate && ymd === formatYMD(selectedCheckInDate);
							const isEnd = selectedCheckOutDate && ymd === formatYMD(selectedCheckOutDate);
							const isInRange =
								selectedCheckInDate &&
								selectedCheckOutDate &&
								cellDate > selectedCheckInDate &&
								cellDate < selectedCheckOutDate;

							const numSpan = document.createElement("span");
							numSpan.className = "calendar-day-num";
							numSpan.textContent = String(currentDayNum);

							if (isPast) {
								td.className += " calendar-day-past";
								td.appendChild(numSpan);
							} else if (isBooked) {
								td.className += " calendar-day-booked";
								const tag = document.createElement("span");
								tag.className = "booked-tag";
								tag.textContent = "Booked";
								td.append(numSpan, tag);
								td.setAttribute("title", `Hotel is booked on ${formatDisplayDate(cellDate)}`);
								td.addEventListener("click", (e) => {
									e.preventDefault();
									e.stopPropagation();
									td.classList.add("shake-booked");
									setTimeout(() => td.classList.remove("shake-booked"), 500);
									showBookingToast(`This hotel is already booked for ${formatDisplayDate(cellDate)}! Please select an available date.`);
								});
							} else {
								td.className += " calendar-day-available";
								if (isStart) td.className += " calendar-day-selected-start";
								if (isEnd) td.className += " calendar-day-selected-end";
								if (isInRange) td.className += " calendar-day-in-range";
								td.appendChild(numSpan);
								td.addEventListener("click", () => handleAvailableDateClick(cellDate, ymd));
							}
							dayCounter++;
						}
						tr.appendChild(td);
					}
					tbody.appendChild(tr);
				}

				table.appendChild(tbody);
				monthBlock.appendChild(table);
				gridContainer.appendChild(monthBlock);
			}
		}

		function handleAvailableDateClick(clickedDate, ymd) {
			if (!selectedCheckInDate || (selectedCheckInDate && selectedCheckOutDate)) {
				selectedCheckInDate = clickedDate;
				selectedCheckOutDate = null;
				checkInInput.value = ymd;
				checkOutInput.value = "";
				if (instructionText) {
					instructionText.textContent = "";
					const strong = document.createElement("strong");
					strong.textContent = formatDisplayDate(clickedDate);
					instructionText.append("Check-in set to ", strong, ". Now choose your check-out date.");
				}
				renderCalendar();
				recalculate();
				return;
			}

			if (clickedDate <= selectedCheckInDate) {
				selectedCheckInDate = clickedDate;
				checkInInput.value = ymd;
				if (instructionText) {
					instructionText.textContent = "";
					const strong = document.createElement("strong");
					strong.textContent = formatDisplayDate(clickedDate);
					instructionText.append("Check-in updated to ", strong, ". Choose your check-out date.");
				}
				renderCalendar();
				recalculate();
				return;
			}

			if (doesRangeContainBooked(selectedCheckInDate, clickedDate)) {
				showBookingToast("Hotel is booked during those dates! Please select an unbroken available range.");
				return;
			}

			selectedCheckOutDate = clickedDate;
			checkOutInput.value = ymd;
			if (instructionText) {
				instructionText.textContent = "";
				const s1 = document.createElement("strong");
				s1.textContent = formatDisplayDate(selectedCheckInDate);
				const s2 = document.createElement("strong");
				s2.textContent = formatDisplayDate(clickedDate);
				instructionText.append("Selected Stay: ", s1, " - ", s2, ".");
			}
			renderCalendar();
			recalculate();
		}

		function recalculate() {
			if (conflictAlert) conflictAlert.classList.add("d-none");
			if (reserveBtn) reserveBtn.disabled = false;

			const inDate = checkInInput.value ? new Date(`${checkInInput.value}T00:00:00`) : null;
			const outDate = checkOutInput.value ? new Date(`${checkOutInput.value}T00:00:00`) : null;

			if (inDate) {
				const nextDay = new Date(inDate);
				nextDay.setDate(nextDay.getDate() + 1);
				checkOutInput.min = formatYMD(nextDay);
			}

			if (inDate && outDate) {
				const nights = Math.max(1, Math.round((outDate - inDate) / (1000 * 60 * 60 * 24)));
				if (statusPill) {
					statusPill.className = "badge bg-success-subtle text-success small border border-success-subtle";
					statusPill.textContent = `${nights} night${nights > 1 ? "s" : ""} selected`;
				}
				if (staySummary) {
					staySummary.textContent = "";
					const span = document.createElement("span");
					span.className = "text-success fw-bold";
					span.textContent = `${nights} night${nights > 1 ? "s" : ""} (${formatYMD(inDate)} -> ${formatYMD(outDate)})`;
					staySummary.appendChild(span);
				}
			} else if (inDate) {
				if (statusPill) {
					statusPill.className = "badge bg-warning-subtle text-warning-emphasis small border border-warning-subtle";
					statusPill.textContent = "Select check-out";
				}
				if (staySummary) {
					staySummary.textContent = `Check-in: ${formatYMD(inDate)} (Select checkout)`;
				}
			} else {
				if (statusPill) {
					statusPill.className = "badge bg-secondary-subtle text-secondary small border";
					statusPill.textContent = "Select on calendar";
				}
				if (staySummary) staySummary.textContent = "No dates selected";
			}

			if (!inDate || !outDate || outDate <= inDate) {
				if (priceContainer) priceContainer.classList.add("d-none");
				return;
			}

			if (doesRangeContainBooked(inDate, outDate)) {
				if (conflictAlert) conflictAlert.classList.remove("d-none");
				if (reserveBtn) reserveBtn.disabled = true;
				if (priceContainer) priceContainer.classList.add("d-none");
				showBookingToast("Hotel is booked during these dates! Please select another date range.");
				return;
			}

			const nights = Math.ceil((outDate.getTime() - inDate.getTime()) / (1000 * 60 * 60 * 24));
			const nightlyRate = Number(data.price) || 0;
			const basePrice = nights * nightlyRate;
			const cleaningFee = 500;
			const taxes = Math.round((basePrice + cleaningFee) * 0.18);
			const total = basePrice + cleaningFee + taxes;

			const nightlyLabel = document.getElementById("nightlyCalculationLabel");
			const baseAmt = document.getElementById("baseCalculationAmount");
			const taxAmt = document.getElementById("taxCalculationAmount");
			const totalAmt = document.getElementById("totalCalculationAmount");

			if (nightlyLabel) nightlyLabel.textContent = `₹${nightlyRate.toLocaleString("en-IN")} × ${nights} night${nights > 1 ? "s" : ""}`;
			if (baseAmt) baseAmt.textContent = `₹${basePrice.toLocaleString("en-IN")}`;
			if (taxAmt) taxAmt.textContent = `₹${taxes.toLocaleString("en-IN")}`;
			if (totalAmt) totalAmt.textContent = `₹${total.toLocaleString("en-IN")}`;

			if (priceContainer) priceContainer.classList.remove("d-none");
		}

		checkInInput.addEventListener("change", () => {
			if (!checkInInput.value) {
				selectedCheckInDate = null;
				renderCalendar();
				recalculate();
				return;
			}
			const inD = new Date(`${checkInInput.value}T00:00:00`);
			if (isDateBooked(inD)) {
				showBookingToast(`This hotel is already booked for ${formatDisplayDate(inD)}! Please select an available date.`);
				checkInInput.value = "";
				selectedCheckInDate = null;
				renderCalendar();
				recalculate();
				return;
			}
			selectedCheckInDate = inD;
			renderCalendar();
			recalculate();
		});

		checkOutInput.addEventListener("change", () => {
			if (!checkOutInput.value) {
				selectedCheckOutDate = null;
				renderCalendar();
				recalculate();
				return;
			}
			const outD = new Date(`${checkOutInput.value}T00:00:00`);
			if (isDateBooked(outD)) {
				showBookingToast(`This hotel is already booked for ${formatDisplayDate(outD)}! Please select an available date.`);
				checkOutInput.value = "";
				selectedCheckOutDate = null;
				renderCalendar();
				recalculate();
				return;
			}
			if (selectedCheckInDate && doesRangeContainBooked(selectedCheckInDate, outD)) {
				showBookingToast("Selected range includes booked dates! Please select an available date range.");
				checkOutInput.value = "";
				selectedCheckOutDate = null;
				renderCalendar();
				recalculate();
				return;
			}
			selectedCheckOutDate = outD;
			renderCalendar();
			recalculate();
		});

		const prevBtn = document.getElementById("prevMonthBtn");
		const nextBtn = document.getElementById("nextMonthBtn");
		const clearBtn = document.getElementById("clearDatesBtn");

		if (prevBtn) {
			prevBtn.addEventListener("click", () => {
				const prevMonth = new Date(calendarStartMonth.getFullYear(), calendarStartMonth.getMonth() - 1, 1);
				const currentMonthAnchor = new Date(today.getFullYear(), today.getMonth(), 1);
				if (prevMonth < currentMonthAnchor) return;
				calendarStartMonth = prevMonth;
				renderCalendar();
			});
		}

		if (nextBtn) {
			nextBtn.addEventListener("click", () => {
				calendarStartMonth = new Date(calendarStartMonth.getFullYear(), calendarStartMonth.getMonth() + 1, 1);
				renderCalendar();
			});
		}

		if (clearBtn) {
			clearBtn.addEventListener("click", () => {
				selectedCheckInDate = null;
				selectedCheckOutDate = null;
				checkInInput.value = "";
				checkOutInput.value = "";
				if (instructionText) {
					instructionText.textContent = "Select your check-in and check-out dates. Booked dates cannot be selected.";
				}
				renderCalendar();
				recalculate();
			});
		}

		renderCalendar();
	});
})();

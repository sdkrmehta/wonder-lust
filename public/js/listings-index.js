(() => {
	const taxSwitch = document.getElementById("taxSwitch");
	if (taxSwitch) {
		taxSwitch.addEventListener("change", () => {
			const basePrices = document.querySelectorAll(".base-price-container");
			const taxPrices = document.querySelectorAll(".tax-price-container");

			if (taxSwitch.checked) {
				basePrices.forEach((el) => el.classList.add("d-none"));
				taxPrices.forEach((el) => el.classList.remove("d-none"));
			} else {
				basePrices.forEach((el) => el.classList.remove("d-none"));
				taxPrices.forEach((el) => el.classList.add("d-none"));
			}
		});
	}

	const sortDropdown = document.getElementById("sortDropdown");
	if (sortDropdown) {
		sortDropdown.addEventListener("change", function () {
			if (this.value) {
				window.location.href = this.value;
			}
		});
	}

	let allListingsMapInstance = null;
	const listingsMapModalEl = document.getElementById("listingsMapModal");

	function escHtml(str) {
		return String(str ?? "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}

	function safeImgUrl(url) {
		if (typeof url !== "string") return "/images/listing-placeholder.jpg";
		const t = url.trim();
		if (/^https?:\/\//i.test(t) || (/^\/[^\/]/.test(t) && !t.includes("\\"))) {
			return escHtml(t);
		}
		return "/images/listing-placeholder.jpg";
	}

	if (listingsMapModalEl) {
		listingsMapModalEl.addEventListener("shown.bs.modal", () => {
			const mapContainer = document.getElementById("allListingsMap");
			const dataEl = document.getElementById("listingsMapData");
			if (!mapContainer || typeof L === "undefined" || !dataEl) return;

			if (!allListingsMapInstance) {
				allListingsMapInstance = L.map("allListingsMap", { scrollWheelZoom: true });
				L.tileLayer(
					"https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
					{
						attribution:
							'Tiles &copy; <a href="https://www.esri.com/" target="_blank">Esri</a> &mdash; Source: Esri, USGS, TomTom',
						maxZoom: 19,
					},
				).addTo(allListingsMapInstance);

				let rawListings = [];
				try {
					rawListings = JSON.parse(dataEl.textContent || "[]");
				} catch {
					rawListings = [];
				}

				const bounds = [];
				rawListings.forEach((item) => {
					let lat = 28.6139;
					let lng = 77.209;
					const isDelhi =
						(item.location || "").toLowerCase().includes("delhi") ||
						(item.country || "").toLowerCase().includes("delhi");
					const isPlaceholder =
						item.coords &&
						Math.abs(Number(item.coords[0]) - 77.209) < 0.005 &&
						Math.abs(Number(item.coords[1]) - 28.6139) < 0.005 &&
						!isDelhi;

					if (item.coords && item.coords.length >= 2 && !isPlaceholder) {
						lng = Number(item.coords[0]) || lng;
						lat = Number(item.coords[1]) || lat;
					} else {
						lat += (Math.random() - 0.5) * 0.15;
						lng += (Math.random() - 0.5) * 0.15;
					}

					bounds.push([lat, lng]);

					const priceTagHtml = `<div class="map-price-pill shadow-sm">&#x20B9;${(Number(item.price) || 0).toLocaleString("en-IN")}</div>`;
					const customIcon = L.divIcon({
						html: priceTagHtml,
						className: "map-price-marker-wrapper",
						iconSize: [68, 28],
						iconAnchor: [34, 14],
					});

					const safeId = encodeURIComponent(String(item.id || ""));
					const safeTitle = escHtml(item.title);
					const safeLoc = escHtml(item.location);
					const safeCountry = escHtml(item.country);
					const safeImage = safeImgUrl(item.image);

					const popupContent = `
						<div class="map-popup-card" style="min-width: 180px;">
							<a href="/listings/${safeId}" class="text-decoration-none text-dark">
								<img src="${safeImage}" alt="${safeTitle}" data-fallback-src="/images/listing-placeholder.jpg" class="w-100 rounded-3 mb-2" style="height: 105px; object-fit: cover;">
								<div class="fw-bold small text-truncate mb-1">${safeTitle}</div>
								<div class="text-muted small mb-1">${safeLoc}, ${safeCountry}</div>
								<div class="mt-1 d-flex justify-content-between align-items-center">
									<span class="fw-bold" style="color: var(--navy-900);">&#x20B9;${(Number(item.price) || 0).toLocaleString("en-IN")} <span class="fw-normal text-muted small">/ night</span></span>
									<span class="small fw-semibold"><i class="fa-solid fa-star text-warning"></i> ${Number(item.rating).toFixed(1)}</span>
								</div>
							</a>
						</div>
					`;

					L.marker([lat, lng], { icon: customIcon })
						.addTo(allListingsMapInstance)
						.bindPopup(popupContent, { maxWidth: 220 });
				});

				if (bounds.length > 0) {
					allListingsMapInstance.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
				} else {
					allListingsMapInstance.setView([20.5937, 78.9629], 5);
				}
			} else {
				setTimeout(() => {
					allListingsMapInstance.invalidateSize();
				}, 150);
			}
		});
	}
})();

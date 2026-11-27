// Wonder-Lust Frontend Client Script & Design System Enhancements
(() => {
	"use strict";

	// 1. Bootstrap Form Validation Guardrails
	const forms = document.querySelectorAll(".needs-validation");
	Array.from(forms).forEach((form) => {
		form.addEventListener(
			"submit",
			(event) => {
				if (!form.checkValidity()) {
					event.preventDefault();
					event.stopPropagation();
				}
				form.classList.add("was-validated");
			},
			false,
		);
	});

	// 2. Auto-Dismiss Flash Toast Notifications
	document.addEventListener("DOMContentLoaded", () => {
		const alerts = document.querySelectorAll(".toast-container-custom .alert");
		alerts.forEach((alert) => {
			setTimeout(() => {
				alert.classList.remove("show");
				setTimeout(() => alert.remove(), 350);
			}, 4500);
		});

		// Sync wishlist state on page load
		syncWishlistIcons();
	});
})();

// 3. Wishlist / Favorites Client-Side Engine
const WISHLIST_STORAGE_KEY = "wonderlust_saved_wishlist";

function getWishlist() {
	try {
		return JSON.parse(localStorage.getItem(WISHLIST_STORAGE_KEY)) || [];
	} catch (e) {
		return [];
	}
}

function saveWishlist(items) {
	try {
		localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(items));
	} catch (e) {
		console.warn("localStorage unavailable:", e.message);
	}
}

function toggleWishlist(event, listingId) {
	if (event) {
		event.preventDefault();
		event.stopPropagation();
	}

	let wishlist = getWishlist();
	const index = wishlist.indexOf(listingId);

	if (index === -1) {
		wishlist.push(listingId);
	} else {
		wishlist.splice(index, 1);
	}

	saveWishlist(wishlist);
	syncWishlistIcons();
}

function syncWishlistIcons() {
	const wishlist = getWishlist();
	document.querySelectorAll(".wishlist-btn").forEach((btn) => {
		const id = btn.getAttribute("data-listing-id");
		if (wishlist.includes(id)) {
			btn.classList.add("active");
			btn.innerHTML = '<i class="fa-solid fa-heart text-danger"></i>';
		} else {
			btn.classList.remove("active");
			btn.innerHTML = '<i class="fa-regular fa-heart"></i>';
		}
	});
}

function openWishlistModal() {
	const wishlist = getWishlist();
	const modalEl = document.getElementById("wishlistModal");
	if (!modalEl) {
		window.location.href = "/listings";
		return;
	}

	const contentEl = document.getElementById("wishlistModalContent");
	if (wishlist.length === 0) {
		contentEl.innerHTML = `
			<div class="text-center py-4">
				<i class="fa-regular fa-heart fa-3x text-muted mb-3" style="opacity: 0.5;"></i>
				<h6>Your wishlist is empty</h6>
				<p class="text-muted small">Tap the heart icon on any property to save your favorite vacation rentals.</p>
				<a href="/listings" class="btn btn-forest btn-sm rounded-pill px-4 mt-2" data-bs-dismiss="modal">Explore Properties</a>
			</div>
		`;
	} else {
		contentEl.textContent = "";
		const wrapper = document.createElement("div");
		wrapper.className = "py-2";

		const countP = document.createElement("p");
		countP.className = "text-muted small mb-3";
		const boldCount = document.createElement("b");
		boldCount.textContent = String(wishlist.length);
		countP.append("You have ", boldCount, " saved property ID(s) in your local collection:");
		wrapper.appendChild(countP);

		const listGroup = document.createElement("div");
		listGroup.className = "list-group list-group-flush mb-3";
		wishlist
			.filter((id) => typeof id === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(id))
			.forEach((id) => {
				const link = document.createElement("a");
				link.href = `/listings/${encodeURIComponent(id)}`;
				link.className =
					"list-group-item list-group-item-action d-flex justify-content-between align-items-center py-2 px-0";

				const label = document.createElement("span");
				label.className = "small font-monospace text-truncate";
				const icon = document.createElement("i");
				icon.className = "fa-solid fa-hotel me-2 text-danger";
				label.append(icon, `Listing #${id}`);

				const badge = document.createElement("span");
				badge.className = "badge bg-light text-dark border rounded-pill";
				badge.textContent = "View ->";

				link.append(label, badge);
				listGroup.appendChild(link);
			});
		wrapper.appendChild(listGroup);

		const clearBtn = document.createElement("button");
		clearBtn.type = "button";
		clearBtn.className = "btn btn-sm btn-outline-danger w-100 rounded-pill";
		clearBtn.textContent = "Clear Wishlist";
		clearBtn.addEventListener("click", clearAllWishlist);
		wrapper.appendChild(clearBtn);

		contentEl.appendChild(wrapper);
	}

	const modal = new bootstrap.Modal(modalEl);
	modal.show();
}

function clearAllWishlist() {
	saveWishlist([]);
	syncWishlistIcons();
	const contentEl = document.getElementById("wishlistModalContent");
	if (contentEl) {
		contentEl.innerHTML = `
			<div class="text-center py-4">
				<i class="fa-regular fa-heart fa-3x text-muted mb-3" style="opacity: 0.5;"></i>
				<h6>Wishlist cleared</h6>
				<p class="text-muted small">Explore listings and heart your favorites anytime.</p>
			</div>
		`;
	}
}

function getCsrfToken() {
	const meta = document.querySelector('meta[name="csrf-token"]');
	return meta ? meta.getAttribute("content") || "" : "";
}
window.getCsrfToken = getCsrfToken;

function injectCsrfIntoForms() {
	const token = getCsrfToken();
	if (!token) return;
	document.querySelectorAll("form").forEach((form) => {
		const method = (form.getAttribute("method") || "GET").toUpperCase();
		if (method === "GET") return;
		let csrfInput = form.querySelector('input[name="_csrf"]');
		if (!csrfInput) {
			csrfInput = document.createElement("input");
			csrfInput.type = "hidden";
			csrfInput.name = "_csrf";
			form.appendChild(csrfInput);
		}
		if (!csrfInput.value) {
			csrfInput.value = token;
		}
	});
}

// 4. Live Unread Notification Badge Updater
function updateNotificationBadge() {
	const badges = [
		document.getElementById("navUnreadBadge"),
		document.getElementById("navUnreadBadgeMobile"),
	].filter(Boolean);
	if (badges.length === 0) return;
	if (!badges.some((badge) => badge.dataset.authenticated === "true")) return;

	fetch("/notifications/unread-count", {
		headers: {
			Accept: "application/json",
			"X-Requested-With": "XMLHttpRequest",
		},
	})
		.then((res) => {
			if (!res.ok) return null;
			return res.json();
		})
		.then((payload) => {
			if (!payload || !payload.data) return;
			const count = payload.data.unreadCount || 0;
			badges.forEach((badge) => {
				if (count > 0) {
					badge.textContent = count > 99 ? "99+" : count;
					badge.classList.remove("d-none");
				} else {
					badge.classList.add("d-none");
				}
			});
		})
		.catch(() => {});
}

document.addEventListener(
	"error",
	(e) => {
		const target = e.target;
		if (target && target.tagName === "IMG" && target.dataset && target.dataset.fallbackSrc) {
			const fallback = target.dataset.fallbackSrc;
			delete target.dataset.fallbackSrc;
			target.src = fallback;
		}
	},
	true,
);

document.addEventListener("click", (e) => {
	const wishlistTrigger = e.target.closest('[data-action="openWishlistModal()"], [data-action="openWishlistModal"]');
	if (wishlistTrigger) {
		e.preventDefault();
		openWishlistModal();
		return;
	}

	const toggleBtn = e.target.closest("[data-wishlist-toggle]");
	if (toggleBtn) {
		toggleWishlist(e, toggleBtn.dataset.wishlistToggle);
		return;
	}

	const printBtn = e.target.closest('[data-action="print"]');
	if (printBtn) {
		e.preventDefault();
		window.print();
		return;
	}

	const confirmBtn = e.target.closest("[data-confirm]:not(form)");
	if (confirmBtn) {
		if (!window.confirm(confirmBtn.dataset.confirm)) {
			e.preventDefault();
			e.stopPropagation();
		}
	}
});

document.addEventListener("submit", (e) => {
	const form = e.target;
	if (form && form.dataset && form.dataset.confirm) {
		if (!window.confirm(form.dataset.confirm)) {
			e.preventDefault();
		}
	}
});

document.addEventListener("change", (e) => {
	const target = e.target;
	if (!target || !target.dataset) return;
	if (target.dataset.autoSubmit === "true" && target.form) {
		target.form.submit();
	} else if (target.dataset.navigateOnChange === "true" && target.value) {
		const navTarget = target.value.trim();
		if (navTarget.startsWith("/") && !navTarget.startsWith("//") && !navTarget.startsWith("/\\")) {
			window.location.href = navTarget;
		}
	}
});

document.addEventListener("DOMContentLoaded", () => {
	injectCsrfIntoForms();
	updateNotificationBadge();
});

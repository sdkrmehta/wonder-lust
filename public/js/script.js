// Wander-Lust Frontend Client Script & Design System Enhancements
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
const WISHLIST_STORAGE_KEY = "wanderlust_saved_wishlist";

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
		contentEl.innerHTML = `
			<div class="py-2">
				<p class="text-muted small mb-3">You have <b>${wishlist.length}</b> saved property ID(s) in your local collection:</p>
				<div class="list-group list-group-flush mb-3">
					${wishlist
						.map(
							(id) => `
						<a href="/listings/${id}" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center py-2 px-0">
							<span class="small font-monospace text-truncate"><i class="fa-solid fa-hotel me-2 text-danger"></i>Listing #${id}</span>
							<span class="badge bg-light text-dark border rounded-pill">View &rarr;</span>
						</a>
					`,
						)
						.join("")}
				</div>
				<button class="btn btn-sm btn-outline-danger w-100 rounded-pill" onclick="clearAllWishlist()">
					Clear Wishlist
				</button>
			</div>
		`;
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

// 4. Live Unread Notification Badge Updater
function updateNotificationBadge() {
	const badges = [
		document.getElementById("navUnreadBadge"),
		document.getElementById("navUnreadBadgeMobile"),
	].filter(Boolean);
	if (badges.length === 0) return;

	fetch("/notifications/unread-count")
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

document.addEventListener("DOMContentLoaded", () => {
	updateNotificationBadge();
});

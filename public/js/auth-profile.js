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
	});
})();

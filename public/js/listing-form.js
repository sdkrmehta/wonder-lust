(() => {
	function bindPreview(inputId, containerId, warningId, submitBtnId, imgHeight, markCoverFirst) {
		const inputEl = document.getElementById(inputId);
		const containerEl = document.getElementById(containerId);
		const warningEl = document.getElementById(warningId);
		const submitBtn = document.getElementById(submitBtnId);

		if (!inputEl || !containerEl) return;

		inputEl.addEventListener("change", (e) => {
			containerEl.innerHTML = "";
			if (warningEl) warningEl.classList.add("d-none");
			if (submitBtn) submitBtn.disabled = false;

			const files = Array.from(e.target.files || []);
			if (files.length === 0) {
				containerEl.classList.add("d-none");
				return;
			}

			containerEl.classList.remove("d-none");
			let hasOversized = false;

			files.forEach((file, idx) => {
				const sizeKB = Math.round(file.size / 1024);
				const isOversized = file.size > 5 * 1024 * 1024;
				if (isOversized) hasOversized = true;

				const col = document.createElement("div");
				col.className = "col-6 col-sm-4 col-md-3";

				const card = document.createElement("div");
				card.className = `card h-100 p-1 position-relative ${isOversized ? "border-danger" : "border"}`;
				card.style.borderRadius = "0.75rem";

				const img = document.createElement("img");
				img.src = URL.createObjectURL(file);
				img.className = "card-img-top rounded";
				img.style.height = imgHeight;
				img.style.objectFit = "cover";

				const info = document.createElement("div");
				info.className = "card-body p-2 text-center";

				const nameEl = document.createElement("p");
				nameEl.className = "card-text text-truncate mb-1 small fw-medium";
				nameEl.title = file.name;
				nameEl.textContent = file.name;

				const sizeBadge = document.createElement("span");
				sizeBadge.className = `badge ${isOversized ? "bg-danger" : "bg-light text-dark"} small`;
				sizeBadge.style.fontSize = "0.7rem";
				sizeBadge.textContent = `${sizeKB} KB`;

				info.appendChild(nameEl);
				info.appendChild(sizeBadge);

				if (markCoverFirst && idx === 0) {
					const coverBadge = document.createElement("span");
					coverBadge.className = "badge bg-success ms-1 small";
					coverBadge.style.fontSize = "0.7rem";
					coverBadge.textContent = "Cover";
					info.appendChild(coverBadge);
				}

				card.appendChild(img);
				card.appendChild(info);
				col.appendChild(card);
				containerEl.appendChild(col);
			});

			if (hasOversized) {
				if (warningEl) warningEl.classList.remove("d-none");
				if (submitBtn) submitBtn.disabled = true;
			}
		});
	}

	document.addEventListener("DOMContentLoaded", () => {
		bindPreview("imageInput", "imagePreviewContainer", "fileSizeWarning", "submitBtn", "95px", true);
		bindPreview("imageEditInput", "editImagePreviewContainer", "editFileSizeWarning", "editSubmitBtn", "90px", false);
	});
})();

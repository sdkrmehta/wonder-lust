(() => {
	function fileKey(file) {
		return `${file.name}::${file.size}::${file.lastModified}`;
	}

	function setInputFiles(inputEl, files) {
		if (typeof DataTransfer === "undefined") return false;
		const dt = new DataTransfer();
		files.forEach((f) => dt.items.add(f));
		inputEl.files = dt.files;
		return true;
	}

	function bindPreview(options) {
		const {
			inputId,
			appendInputId,
			addMoreBtnId,
			containerId,
			sizeWarningId,
			countWarningId,
			countBadgeId,
			submitBtnId,
			imgHeight,
			markCoverFirst,
		} = options;

		const inputEl = document.getElementById(inputId);
		const appendInputEl = appendInputId ? document.getElementById(appendInputId) : null;
		const addMoreBtn = addMoreBtnId ? document.getElementById(addMoreBtnId) : null;
		const containerEl = document.getElementById(containerId);
		const sizeWarningEl = document.getElementById(sizeWarningId);
		const countWarningEl = document.getElementById(countWarningId);
		const countBadgeEl = document.getElementById(countBadgeId);
		const submitBtn = document.getElementById(submitBtnId);

		if (!inputEl || !containerEl) return;

		const minFiles = Number.parseInt(inputEl.dataset.minFiles || "0", 10) || 0;
		const maxFiles = Number.parseInt(inputEl.dataset.maxFiles || "10", 10);
		const existingCount = Number.parseInt(inputEl.dataset.existingCount || "0", 10) || 0;
		const formEl = inputEl.closest("form");
		let objectUrls = [];

		function updateCountMessage(count) {
			if (countBadgeEl) {
				if (minFiles > 0) {
					countBadgeEl.textContent = `${count} / ${minFiles}–${maxFiles} selected`;
					const validRange = count >= minFiles && count <= maxFiles;
					countBadgeEl.className = validRange
						? "badge rounded-pill bg-success-subtle text-success-emphasis"
						: count > 0
							? "badge rounded-pill bg-warning-subtle text-warning-emphasis"
							: "badge rounded-pill bg-secondary-subtle text-secondary-emphasis";
				} else {
					const total = existingCount + count;
					countBadgeEl.textContent = `${total} / 10 total in gallery`;
					countBadgeEl.className = count > maxFiles
						? "badge rounded-pill bg-danger-subtle text-danger-emphasis"
						: "badge rounded-pill bg-secondary-subtle text-secondary-emphasis";
				}
			}
		}

		function showCountWarning(msg) {
			if (!countWarningEl) return;
			countWarningEl.innerHTML = `<i class="fa-solid fa-circle-info me-1"></i> ${msg}`;
			countWarningEl.classList.remove("d-none");
		}

		function validateSelection(files, { isSubmit = false } = {}) {
			let validityMsg = "";
			const tooMany = files.length > maxFiles;
			const tooFew = minFiles > 0 && files.length < minFiles;

			if (tooMany) {
				validityMsg = minFiles > 0
					? `You can upload a maximum of ${maxFiles} photos (currently ${files.length} selected).`
					: `You can add at most ${maxFiles} more photo${maxFiles === 1 ? "" : "s"} (gallery maximum is 10).`;
				showCountWarning(validityMsg);
			} else if (tooFew && (files.length > 0 || isSubmit)) {
				const remaining = minFiles - files.length;
				validityMsg = `Please select at least ${minFiles} photos (currently ${files.length} selected; ${remaining} more needed, maximum ${maxFiles}).`;
				showCountWarning(validityMsg);
			} else if (countWarningEl) {
				countWarningEl.classList.add("d-none");
				countWarningEl.textContent = "";
			}

			inputEl.setCustomValidity(validityMsg);
			return !validityMsg;
		}

		function renderFiles() {
			objectUrls.forEach((u) => URL.revokeObjectURL(u));
			objectUrls = [];
			containerEl.innerHTML = "";
			if (sizeWarningEl) sizeWarningEl.classList.add("d-none");
			if (submitBtn) submitBtn.disabled = false;

			const files = Array.from(inputEl.files || []);
			updateCountMessage(files.length);

			if (addMoreBtn) {
				if (files.length > 0 && files.length < maxFiles) {
					addMoreBtn.classList.remove("d-none");
				} else {
					addMoreBtn.classList.add("d-none");
				}
			}

			const countValid = validateSelection(files, { isSubmit: false });

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

				const removeBtn = document.createElement("button");
				removeBtn.type = "button";
				removeBtn.className = "btn btn-sm btn-dark position-absolute top-0 end-0 m-1 rounded-circle d-flex align-items-center justify-content-center p-0";
				removeBtn.style.width = "22px";
				removeBtn.style.height = "22px";
				removeBtn.style.fontSize = "0.72rem";
				removeBtn.setAttribute("aria-label", `Remove ${file.name}`);
				removeBtn.dataset.removeIndex = String(idx);
				removeBtn.innerHTML = "&times;";

				const objUrl = URL.createObjectURL(file);
				objectUrls.push(objUrl);

				const img = document.createElement("img");
				img.src = objUrl;
				img.className = "card-img-top rounded";
				img.style.height = imgHeight;
				img.style.objectFit = "cover";
				img.alt = file.name;

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

				card.appendChild(removeBtn);
				card.appendChild(img);
				card.appendChild(info);
				col.appendChild(card);
				containerEl.appendChild(col);
			});

			if (hasOversized) {
				if (sizeWarningEl) sizeWarningEl.classList.remove("d-none");
			}
			if (submitBtn) {
				submitBtn.disabled = hasOversized || !countValid;
			}
		}

		inputEl.addEventListener("change", renderFiles);

		containerEl.addEventListener("click", (e) => {
			const removeBtn = e.target.closest("[data-remove-index]");
			if (!removeBtn) return;
			const idx = Number.parseInt(removeBtn.dataset.removeIndex, 10);
			const current = Array.from(inputEl.files || []);
			if (Number.isNaN(idx) || idx < 0 || idx >= current.length) return;
			current.splice(idx, 1);
			if (setInputFiles(inputEl, current)) {
				renderFiles();
			}
		});

		if (addMoreBtn && appendInputEl) {
			addMoreBtn.addEventListener("click", () => {
				appendInputEl.value = "";
				appendInputEl.click();
			});

			appendInputEl.addEventListener("change", () => {
				const extra = Array.from(appendInputEl.files || []);
				if (extra.length === 0) return;
				const current = Array.from(inputEl.files || []);
				const seen = new Set(current.map(fileKey));
				const merged = [...current];
				for (const f of extra) {
					if (!seen.has(fileKey(f))) {
						seen.add(fileKey(f));
						merged.push(f);
					}
				}
				if (setInputFiles(inputEl, merged)) {
					renderFiles();
				}
				appendInputEl.value = "";
			});
		}

		if (formEl) {
			formEl.addEventListener("submit", (e) => {
				const files = Array.from(inputEl.files || []);
				const hasOversized = files.some((f) => f.size > 5 * 1024 * 1024);
				const countValid = validateSelection(files, { isSubmit: true });
				if (!countValid || hasOversized) {
					e.preventDefault();
					e.stopPropagation();
					formEl.classList.add("was-validated");
					inputEl.scrollIntoView({ behavior: "smooth", block: "center" });
				}
			});
		}

		renderFiles();
	}

	document.addEventListener("DOMContentLoaded", () => {
		bindPreview({
			inputId: "imageInput",
			appendInputId: "imageAppendInput",
			addMoreBtnId: "addMoreImagesBtn",
			containerId: "imagePreviewContainer",
			sizeWarningId: "fileSizeWarning",
			countWarningId: "fileCountWarning",
			countBadgeId: "imageCountBadge",
			submitBtnId: "submitBtn",
			imgHeight: "95px",
			markCoverFirst: true,
		});
		bindPreview({
			inputId: "imageEditInput",
			appendInputId: "imageEditAppendInput",
			addMoreBtnId: "addMoreEditImagesBtn",
			containerId: "editImagePreviewContainer",
			sizeWarningId: "editFileSizeWarning",
			countWarningId: "editFileCountWarning",
			countBadgeId: "editImageCountBadge",
			submitBtnId: "editSubmitBtn",
			imgHeight: "90px",
			markCoverFirst: false,
		});
	});
})();

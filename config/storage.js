const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadDir = path.join(__dirname, "..", "public", "uploads");

// Ensure upload directory exists
if (!fs.existsSync(uploadDir)) {
	fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer disk storage for local image uploads
const storage = multer.diskStorage({
	destination: function (req, file, cb) {
		cb(null, uploadDir);
	},
	filename: function (req, file, cb) {
		const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
		const ext = path.extname(file.originalname).toLowerCase();
		cb(null, `${uniqueSuffix}${ext}`);
	},
});

// File filter: accept image types only (JPEG, PNG, WebP, GIF)
function fileFilter(req, file, cb) {
	const allowedTypes = /jpeg|jpg|png|webp|gif/;
	const extname = allowedTypes.test(
		path.extname(file.originalname).toLowerCase(),
	);
	const mimetype = allowedTypes.test(file.mimetype);

	if (extname && mimetype) {
		return cb(null, true);
	}
	cb(new Error("Invalid file format. Only JPEG, JPG, PNG, WEBP, and GIF images are permitted."));
}

const upload = multer({
	storage,
	fileFilter,
	limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max per file
});

const uploadListingFields = upload.fields([
	{ name: "listing[image]", maxCount: 1 },
	{ name: "listing[images]", maxCount: 10 },
	{ name: "image", maxCount: 1 },
	{ name: "images", maxCount: 10 },
]);

/**
 * Universal middleware that accepts single and multi-image uploads,
 * enforces file size & mime validation, and normalizes req.file & req.listingImages.
 */
function handleListingUpload(req, res, next) {
	uploadListingFields(req, res, (err) => {
		if (err) {
			const isApi = req.originalUrl && req.originalUrl.startsWith("/api/");
			let msg = err.message || "Failed to upload image.";
			if (err.code === "LIMIT_FILE_SIZE") {
				msg = "Image size exceeds 5MB limit. Please upload a smaller photo.";
			}
			if (isApi) {
				return res.status(400).json({ status: "error", message: msg });
			}
			req.flash("error", msg);
			return res.redirect("back");
		}

		// Normalize single and multiple files into req.file and req.listingImages
		if (req.files) {
			const single =
				(req.files["listing[image]"] && req.files["listing[image]"][0]) ||
				(req.files["image"] && req.files["image"][0]);
			const multi =
				(req.files["listing[images]"]) ||
				(req.files["images"]) ||
				[];

			if (single) {
				req.file = single;
			} else if (multi.length > 0) {
				req.file = multi[0];
			}

			// Deduplicate in case single was also passed
			const all = single ? [single, ...multi.filter((f) => f !== single)] : multi;
			req.listingImages = all;
		} else if (req.file) {
			req.listingImages = [req.file];
		} else {
			req.listingImages = [];
		}

		next();
	});
}

const uploadAvatarField = upload.single("avatar");

function handleAvatarUpload(req, res, next) {
	uploadAvatarField(req, res, (err) => {
		if (err) {
			const isApi = req.originalUrl && req.originalUrl.startsWith("/api/");
			let msg = err.message || "Failed to upload avatar.";
			if (err.code === "LIMIT_FILE_SIZE") {
				msg = "Avatar image size exceeds 5MB limit.";
			}
			if (isApi) {
				return res.status(400).json({ status: "error", message: msg });
			}
			req.flash("error", msg);
			return res.redirect("back");
		}
		next();
	});
}

// Cleanup helper to delete orphaned files from local disk
function cleanupLocalFile(filename) {
	if (!filename) return;
	const cleanName = path.basename(filename);
	const targetPath = path.join(uploadDir, cleanName);

	if (fs.existsSync(targetPath)) {
		try {
			fs.unlinkSync(targetPath);
		} catch (err) {
			console.error("[STORAGE] Error deleting local file:", err.message);
		}
	}
}

module.exports = {
	upload,
	storage,
	uploadDir,
	cleanupLocalFile,
	handleListingUpload,
	handleAvatarUpload,
};

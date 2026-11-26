const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const env = require("./env");
const { cleanNoSql, cleanXss } = require("../middleware/sanitize.middleware");
const { verifyMultipartCsrf } = require("../middleware/csrf.middleware");

const uploadDir = path.join(__dirname, "..", "public", "uploads");

const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const ALLOWED_MIMETYPES = new Set([
	"image/jpeg",
	"image/jpg",
	"image/png",
	"image/webp",
	"image/gif",
]);

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
		const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
		const ext = path.extname(file.originalname).toLowerCase();
		cb(null, `${uniqueSuffix}${ALLOWED_EXTENSIONS.has(ext) ? ext : ".bin"}`);
	},
});

// Strict anchored file filter: accept allowed extensions and mimetypes only
function fileFilter(req, file, cb) {
	const ext = path.extname(file.originalname || "").toLowerCase();
	const mime = (file.mimetype || "").toLowerCase();

	if (ALLOWED_EXTENSIONS.has(ext) && ALLOWED_MIMETYPES.has(mime)) {
		return cb(null, true);
	}
	cb(new Error("Invalid file format. Only JPEG, JPG, PNG, WEBP, and GIF images are permitted."));
}

function hasValidImageSignature(filePath, ext) {
	let fd;
	try {
		fd = fs.openSync(filePath, "r");
		const buf = Buffer.alloc(12);
		const bytesRead = fs.readSync(fd, buf, 0, 12, 0);
		if (bytesRead < 4) return false;

		if (ext === ".jpg" || ext === ".jpeg") {
			return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
		}
		if (ext === ".png") {
			return (
				bytesRead >= 8 &&
				buf[0] === 0x89 &&
				buf[1] === 0x50 &&
				buf[2] === 0x4e &&
				buf[3] === 0x47 &&
				buf[4] === 0x0d &&
				buf[5] === 0x0a &&
				buf[6] === 0x1a &&
				buf[7] === 0x0a
			);
		}
		if (ext === ".gif") {
			return (
				buf[0] === 0x47 &&
				buf[1] === 0x49 &&
				buf[2] === 0x46 &&
				buf[3] === 0x38
			);
		}
		if (ext === ".webp") {
			return (
				bytesRead >= 12 &&
				buf.toString("ascii", 0, 4) === "RIFF" &&
				buf.toString("ascii", 8, 12) === "WEBP"
			);
		}
		return false;
	} catch {
		return false;
	} finally {
		if (fd !== undefined) {
			try {
				fs.closeSync(fd);
			} catch {
				// Ignore close failure
			}
		}
	}
}

function getSafeBackUrl(req, fallback = "/listings") {
	const referer = req.get("referer") || req.get("referrer");
	if (!referer) return fallback;
	try {
		const parsed = new URL(referer);
		const reqHost = (req.get("host") || "").toLowerCase();
		if (parsed.host.toLowerCase() === reqHost) {
			const rel = `${parsed.pathname}${parsed.search}`;
			if (rel.startsWith("/") && !rel.startsWith("//") && !rel.startsWith("/\\")) {
				return rel;
			}
		}
	} catch {
		// Fall through to safe fallback
	}
	return fallback;
}

function collectUploadedFiles(req) {
	const collected = [];
	if (req.file) collected.push(req.file);
	if (Array.isArray(req.listingImages)) collected.push(...req.listingImages);
	if (req.files) {
		if (Array.isArray(req.files)) {
			collected.push(...req.files);
		} else {
			for (const arr of Object.values(req.files)) {
				if (Array.isArray(arr)) collected.push(...arr);
			}
		}
	}
	return [...new Set(collected)];
}

function cleanupRequestUploads(req) {
	for (const file of collectUploadedFiles(req)) {
		if (file && file.filename) {
			cleanupLocalFile(file.filename);
		}
	}
}

function verifyUploadedMagicBytes(req) {
	for (const file of collectUploadedFiles(req)) {
		const ext = path.extname(file.filename || file.originalname || "").toLowerCase();
		const targetPath = path.join(uploadDir, path.basename(file.filename));
		if (!hasValidImageSignature(targetPath, ext)) {
			return false;
		}
	}
	return true;
}

const upload = multer({
	storage,
	fileFilter,
	limits: {
		fileSize: env.MAX_FILE_SIZE_MB * 1024 * 1024,
		files: 11,
	},
});

const uploadListingFields = upload.fields([
	{ name: "listing[image]", maxCount: 1 },
	{ name: "listing[images]", maxCount: 10 },
	{ name: "image", maxCount: 1 },
	{ name: "images", maxCount: 10 },
]);

/**
 * Universal middleware that accepts single and multi-image uploads,
 * enforces file size, MIME, magic-byte signature, CSRF token, and body sanitization.
 */
function handleListingUpload(req, res, next) {
	uploadListingFields(req, res, (err) => {
		const isApi =
			(req.originalUrl && req.originalUrl.startsWith("/api/")) ||
			req.xhr ||
			req.headers.accept === "application/json";

		if (err) {
			cleanupRequestUploads(req);
			let msg = err.message || "Failed to upload image.";
			if (err.code === "LIMIT_FILE_SIZE") {
				msg = `Image size exceeds ${env.MAX_FILE_SIZE_MB}MB limit. Please upload a smaller photo.`;
			}
			if (isApi) {
				return res.status(400).json({ status: "error", message: msg });
			}
			req.flash("error", msg);
			return res.redirect(getSafeBackUrl(req, "/listings"));
		}

		// Verify deferred multipart CSRF token
		if (!verifyMultipartCsrf(req)) {
			cleanupRequestUploads(req);
			const csrfMsg = "Invalid or missing CSRF security token. Please refresh and try again.";
			if (isApi) {
				return res.status(403).json({ status: "fail", message: csrfMsg });
			}
			req.flash("error", csrfMsg);
			return res.status(403).redirect(getSafeBackUrl(req, "/listings"));
		}

		// Sanitize multipart text fields parsed by Multer
		if (req.body && typeof req.body === "object") {
			req.body = cleanNoSql(cleanXss(req.body));
		}

		// Verify actual file header signatures (blocks renamed scripts/HTML)
		if (!verifyUploadedMagicBytes(req)) {
			cleanupRequestUploads(req);
			const sigMsg = "Invalid image file contents. File header does not match permitted image formats.";
			if (isApi) {
				return res.status(400).json({ status: "error", message: sigMsg });
			}
			req.flash("error", sigMsg);
			return res.redirect(getSafeBackUrl(req, "/listings"));
		}

		// Normalize single and multiple files into req.file and req.listingImages
		if (req.files) {
			const single =
				(req.files["listing[image]"] && req.files["listing[image]"][0]) ||
				(req.files["image"] && req.files["image"][0]);
			const multi =
				req.files["listing[images]"] ||
				req.files["images"] ||
				[];

			if (single) {
				req.file = single;
			} else if (multi.length > 0) {
				req.file = multi[0];
			}

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
		const isApi =
			(req.originalUrl && req.originalUrl.startsWith("/api/")) ||
			req.xhr ||
			req.headers.accept === "application/json";

		if (err) {
			cleanupRequestUploads(req);
			let msg = err.message || "Failed to upload avatar.";
			if (err.code === "LIMIT_FILE_SIZE") {
				msg = `Avatar image size exceeds ${env.MAX_FILE_SIZE_MB}MB limit.`;
			}
			if (isApi) {
				return res.status(400).json({ status: "error", message: msg });
			}
			req.flash("error", msg);
			return res.redirect(getSafeBackUrl(req, "/profile/edit"));
		}

		if (!verifyMultipartCsrf(req)) {
			cleanupRequestUploads(req);
			const csrfMsg = "Invalid or missing CSRF security token. Please refresh and try again.";
			if (isApi) {
				return res.status(403).json({ status: "fail", message: csrfMsg });
			}
			req.flash("error", csrfMsg);
			return res.status(403).redirect(getSafeBackUrl(req, "/profile/edit"));
		}

		if (req.body && typeof req.body === "object") {
			req.body = cleanNoSql(cleanXss(req.body));
		}

		if (!verifyUploadedMagicBytes(req)) {
			cleanupRequestUploads(req);
			const sigMsg = "Invalid avatar file contents. File header does not match permitted image formats.";
			if (isApi) {
				return res.status(400).json({ status: "error", message: sigMsg });
			}
			req.flash("error", sigMsg);
			return res.redirect(getSafeBackUrl(req, "/profile/edit"));
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
	cleanupRequestUploads,
	handleListingUpload,
	handleAvatarUpload,
};

const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const env = require("./env");
const AppError = require("../utils/AppError");
const { cleanNoSql, cleanXss } = require("../middleware/sanitize.middleware");
const { verifyMultipartCsrf } = require("../middleware/csrf.middleware");

const uploadDir = path.join(__dirname, "..", "public", "uploads");
const MIN_LISTING_IMAGES = 5;
const MAX_LISTING_IMAGES = 10;

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
		files: MAX_LISTING_IMAGES,
	},
});

const uploadListingFields = upload.fields([
	{ name: "listing[image]", maxCount: MAX_LISTING_IMAGES },
	{ name: "listing[images]", maxCount: MAX_LISTING_IMAGES },
	{ name: "image", maxCount: MAX_LISTING_IMAGES },
	{ name: "images", maxCount: MAX_LISTING_IMAGES },
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
			} else if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
				msg = `You can upload a maximum of ${MAX_LISTING_IMAGES} photos per listing.`;
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

		// Normalize uploaded files across all accepted field names into req.file and req.listingImages
		if (req.files) {
			const all = [
				...(req.files["listing[image]"] || []),
				...(req.files["image"] || []),
				...(req.files["listing[images]"] || []),
				...(req.files["images"] || []),
			];

			if (all.length > MAX_LISTING_IMAGES) {
				cleanupRequestUploads(req);
				const maxMsg = `You can upload a maximum of ${MAX_LISTING_IMAGES} photos per listing.`;
				if (isApi) {
					return res.status(400).json({ status: "error", message: maxMsg });
				}
				req.flash("error", maxMsg);
				return res.redirect(getSafeBackUrl(req, "/listings"));
			}

			req.file = all[0] || undefined;
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
	const cleanName = path.basename(String(filename));
	if (!cleanName || cleanName === "." || cleanName === "..") return;
	const targetPath = path.join(uploadDir, cleanName);

	if (fs.existsSync(targetPath)) {
		try {
			fs.unlinkSync(targetPath);
		} catch (err) {
			console.error("[STORAGE] Error deleting local file:", err.message);
		}
	}
}

function buildCloudinarySignature(params, apiSecret) {
	const canonical = Object.keys(params)
		.filter((k) => params[k] !== undefined && params[k] !== null && String(params[k]) !== "")
		.sort()
		.map((k) => `${k}=${params[k]}`)
		.join("&");
	return crypto.createHash("sha1").update(`${canonical}${apiSecret}`).digest("hex");
}

function isCloudinaryAsset(assetOrFilename) {
	if (!assetOrFilename) return false;
	if (typeof assetOrFilename === "string") {
		return assetOrFilename.includes("/") && !assetOrFilename.startsWith("/uploads/");
	}
	const url = typeof assetOrFilename.url === "string" ? assetOrFilename.url : "";
	const filename = typeof assetOrFilename.filename === "string" ? assetOrFilename.filename : "";
	return (
		url.includes("res.cloudinary.com") ||
		(filename.includes("/") && !filename.startsWith("/uploads/"))
	);
}

async function uploadLocalFileToCloudinary(file, folder = "wonderlust/listings") {
	if (!env.isCloudinaryConfigured) {
		throw new AppError(500, "Cloud media storage is not configured.");
	}
	const diskPath = file.path || path.join(uploadDir, path.basename(file.filename));
	const fileBuffer = await fs.promises.readFile(diskPath);
	const timestamp = Math.floor(Date.now() / 1000);
	const signParams = { folder, timestamp };
	const signature = buildCloudinarySignature(signParams, env.cloudinary.apiSecret);

	const form = new FormData();
	form.append(
		"file",
		new Blob([fileBuffer], { type: file.mimetype || "application/octet-stream" }),
		file.filename || file.originalname || "upload.jpg",
	);
	form.append("api_key", env.cloudinary.apiKey);
	form.append("timestamp", String(timestamp));
	form.append("folder", folder);
	form.append("signature", signature);

	const endpoint = `${env.CLOUDINARY_API_BASE}/v1_1/${encodeURIComponent(env.cloudinary.cloudName)}/image/upload`;
	let res;
	try {
		res = await fetch(endpoint, {
			method: "POST",
			body: form,
			signal: AbortSignal.timeout(30000),
		});
	} catch (err) {
		throw new AppError(
			502,
			`Cloud image upload network error (${err.message || "fetch failed"}). Please try again.`,
		);
	}

	let data = null;
	try {
		data = await res.json();
	} catch {
		data = null;
	}

	if (!res.ok || !data || (!data.secure_url && !data.url)) {
		const detail =
			(data && data.error && data.error.message) ||
			`HTTP ${res.status}`;
		throw new AppError(502, `Cloud image upload failed (${detail}). Please try again.`);
	}

	const secureUrl =
		typeof data.secure_url === "string" && data.secure_url
			? data.secure_url
			: String(data.url).replace(/^http:\/\//i, "https://");

	return {
		url: secureUrl,
		filename: data.public_id || file.filename,
	};
}

async function destroyCloudinaryAsset(publicId) {
	if (!publicId || !env.isCloudinaryConfigured) return;
	const timestamp = Math.floor(Date.now() / 1000);
	const signature = buildCloudinarySignature(
		{ public_id: publicId, timestamp },
		env.cloudinary.apiSecret,
	);
	const form = new FormData();
	form.append("public_id", publicId);
	form.append("api_key", env.cloudinary.apiKey);
	form.append("timestamp", String(timestamp));
	form.append("signature", signature);

	const endpoint = `${env.CLOUDINARY_API_BASE}/v1_1/${encodeURIComponent(env.cloudinary.cloudName)}/image/destroy`;
	try {
		await fetch(endpoint, {
			method: "POST",
			body: form,
			signal: AbortSignal.timeout(10000),
		});
	} catch (err) {
		console.warn("[STORAGE] Cloudinary cleanup skipped:", err.message);
	}
}

async function persistUploadedFiles(files = [], { folder = "wonderlust/listings" } = {}) {
	if (!Array.isArray(files) || files.length === 0) {
		return [];
	}

	if (env.UPLOAD_STORAGE === "cloudinary" && env.isCloudinaryConfigured) {
		const settled = await Promise.allSettled(
			files.map((file) => uploadLocalFileToCloudinary(file, folder)),
		);
		for (const file of files) {
			if (file && file.filename) {
				cleanupLocalFile(file.filename);
			}
		}
		const failed = settled.find((r) => r.status === "rejected");
		if (failed) {
			const uploadedIds = settled
				.filter((r) => r.status === "fulfilled" && r.value && r.value.filename)
				.map((r) => r.value.filename);
			await Promise.all(uploadedIds.map((pubId) => destroyCloudinaryAsset(pubId)));
			throw failed.reason;
		}
		return settled.map((r) => r.value);
	}

	return files.map((file) => ({
		url: `/uploads/${file.filename}`,
		filename: file.filename,
	}));
}

async function persistUploadedFile(file, options = {}) {
	if (!file) return null;
	const [stored] = await persistUploadedFiles([file], options);
	return stored || null;
}

async function deleteStoredAsset(assetOrFilename) {
	if (!assetOrFilename) return;
	const filename =
		typeof assetOrFilename === "string"
			? assetOrFilename
			: assetOrFilename.filename || "";

	if (isCloudinaryAsset(assetOrFilename)) {
		await destroyCloudinaryAsset(filename);
		return;
	}
	if (filename) {
		cleanupLocalFile(filename);
	}
}

module.exports = {
	upload,
	storage,
	uploadDir,
	MIN_LISTING_IMAGES,
	MAX_LISTING_IMAGES,
	cleanupLocalFile,
	cleanupRequestUploads,
	handleListingUpload,
	handleAvatarUpload,
	persistUploadedFiles,
	persistUploadedFile,
	deleteStoredAsset,
};

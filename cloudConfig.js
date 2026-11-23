// Backward-compatibility proxy for config/storage.js
const { storage, upload, cleanupLocalFile } = require("./config/storage.js");

module.exports = {
	storage,
	upload,
	cleanupLocalFile,
};

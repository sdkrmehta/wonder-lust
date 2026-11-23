const mongoose = require("mongoose");
const env = require("./env");

let isConnected = false;

async function connectDB(customUrl) {
	const url = customUrl || env.DB_URL;

	if (isConnected) {
		return mongoose.connection;
	}

	try {
		await mongoose.connect(url, {
			serverSelectionTimeoutMS: 5000,
			maxPoolSize: 10,
		});

		isConnected = true;
		console.log(`[DATABASE] Connected successfully to: ${url.replace(/\/\/.*@/, "//***@")}`);
		return mongoose.connection;
	} catch (error) {
		console.error("[DATABASE] Connection error:", error.message);
		throw error;
	}
}

async function disconnectDB() {
	if (!isConnected) return;
	try {
		await mongoose.disconnect();
		isConnected = false;
		console.log("[DATABASE] Disconnected successfully.");
	} catch (error) {
		console.error("[DATABASE] Disconnect error:", error.message);
	}
}

// Global connection event listeners
mongoose.connection.on("error", (err) => {
	console.error("[DATABASE] Mongoose runtime error:", err.message);
});

mongoose.connection.on("disconnected", () => {
	isConnected = false;
});

async function syncAllIndexes() {
	const models = [
		require("../models/listing"),
		require("../models/booking"),
		require("../models/payment"),
		require("../models/review"),
		require("../models/user"),
		require("../models/notification"),
		require("../models/conversation"),
		require("../models/message"),
	];

	const results = [];
	for (const model of models) {
		try {
			await model.syncIndexes();
			results.push({ model: model.modelName, status: "synchronized" });
		} catch (err) {
			results.push({ model: model.modelName, status: "error", error: err.message });
		}
	}
	return results;
}

module.exports = {
	connectDB,
	disconnectDB,
	syncAllIndexes,
	getConnectionState: () => mongoose.connection.readyState,
};

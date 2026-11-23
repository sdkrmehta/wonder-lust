const env = require("./config/env");
const { connectDB, disconnectDB, syncAllIndexes } = require("./config/database");
const app = require("./app");

let server;

async function startServer() {
	try {
		// Initialize database connection
		await connectDB();
		// Synchronize database schema indexes & auto-migrate coordinates
		syncAllIndexes().catch((err) => {
			console.warn("[SERVER] Index synchronization warning:", err.message);
		});
		require("./scripts/fix_geometries")().catch((err) => {
			console.warn("[SERVER] Geometry migration warning:", err.message);
		});

		// Start HTTP listener
		server = app.listen(env.PORT, () => {
			console.log(
				`[SERVER] Server is listening on port ${env.PORT}. (Running in ${env.NODE_ENV} mode)`,
			);
			console.log(`[SERVER] Accessible at http://localhost:${env.PORT}/listings`);
		});
	} catch (error) {
		console.error("[SERVER] Startup failed:", error.message);
		process.exit(1);
	}
}

// Graceful Shutdown Handler
async function gracefulShutdown(signal) {
	console.log(`\n[SERVER] ${signal} signal received. Closing HTTP server...`);
	if (server) {
		server.close(async () => {
			console.log("[SERVER] HTTP server closed.");
			await disconnectDB();
			console.log("[SERVER] Process terminated gracefully.");
			process.exit(0);
		});
	} else {
		await disconnectDB();
		process.exit(0);
	}
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Start server
startServer();

const session = require("express-session");
const MongoStore = require("connect-mongo");
const env = require("./env");

function createSessionConfig() {
	const store = MongoStore.create({
		mongoUrl: env.DB_URL,
		crypto: {
			secret: env.SESSION_SECRET,
		},
		touchAfter: 24 * 3600, // Lazy session update every 24 hours unless data changed
	});

	store.on("error", (err) => {
		console.error("[SESSION STORE] MongoStore error:", err.message);
	});

	return {
		store,
		secret: env.SESSION_SECRET,
		resave: false,
		saveUninitialized: true,
		cookie: {
			expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
			maxAge: 7 * 24 * 60 * 60 * 1000,
			httpOnly: true,
			secure: env.isProduction,
			sameSite: "lax",
		},
	};
}

module.exports = {
	createSessionConfig,
};

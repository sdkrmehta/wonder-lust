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
		name: env.SESSION_NAME,
		store,
		secret: env.SESSION_SECRET,
		resave: false,
		saveUninitialized: false,
		cookie: {
			maxAge: env.SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
			httpOnly: true,
			secure: env.COOKIE_SECURE,
			sameSite: "lax",
		},
	};
}

module.exports = {
	createSessionConfig,
};

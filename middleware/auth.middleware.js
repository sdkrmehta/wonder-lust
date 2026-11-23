module.exports.isLoggedIn = (req, res, next) => {
	if (!req.isAuthenticated()) {
		// Only save idempotent GET requests to avoid redirecting to POST/PUT/DELETE
		if (req.method === "GET") {
			req.session.redirectUrl = req.originalUrl;
		}
		if (req.originalUrl.startsWith("/api/") || req.xhr) {
			return res.status(401).json({ status: "fail", message: "Authentication required" });
		}
		req.flash("error", "Please log in to continue.");
		return res.redirect("/login");
	}
	next();
};

module.exports.isAdmin = (req, res, next) => {
	if (!req.isAuthenticated()) {
		if (req.method === "GET") {
			req.session.redirectUrl = req.originalUrl;
		}
		if (req.originalUrl.startsWith("/api/") || req.xhr) {
			return res.status(401).json({ status: "fail", message: "Authentication required" });
		}
		req.flash("error", "Please log in to continue.");
		return res.redirect("/login");
	}

	if (req.user.role !== "admin") {
		if (req.originalUrl.startsWith("/api/") || req.xhr) {
			return res.status(403).json({ status: "fail", message: "Forbidden: Admin privileges required" });
		}
		req.flash("error", "Access denied. Administrator privileges required.");
		return res.redirect("/listings");
	}

	next();
};

module.exports.saveRedirectUrl = (req, res, next) => {
	if (req.session.redirectUrl) {
		res.locals.redirectUrl = req.session.redirectUrl;
	}
	next();
};

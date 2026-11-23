const HostService = require("../services/host.service");

module.exports.renderDashboard = async (req, res) => {
	try {
		const dashboardData = await HostService.getHostDashboardMetrics(req.user._id);
		res.render("host/dashboard.ejs", dashboardData);
	} catch (err) {
		req.flash("error", err.message || "Failed to load host dashboard.");
		res.redirect("/listings");
	}
};

module.exports.renderListings = async (req, res) => {
	try {
		const dashboardData = await HostService.getHostDashboardMetrics(req.user._id);
		res.render("host/listings.ejs", dashboardData);
	} catch (err) {
		req.flash("error", err.message || "Failed to load host listings.");
		res.redirect("/host/dashboard");
	}
};

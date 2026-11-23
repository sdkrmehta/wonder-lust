const AdminService = require("../services/admin.service");
const ApiResponse = require("../utils/apiResponse");

class AdminController {
	/**
	 * Web UI: Platform KPIs and Administration Dashboard.
	 */
	static async renderDashboard(req, res) {
		const metrics = await AdminService.getPlatformMetrics();
		res.render("admin/dashboard.ejs", { metrics });
	}

	/**
	 * Web UI: Platform User Directory & Role Management.
	 */
	static async renderUsers(req, res) {
		const { search = "", role = "", page = 1 } = req.query;
		const result = await AdminService.getUsers({ search, role, page, limit: 15 });

		res.render("admin/users.ejs", {
			users: result.users,
			total: result.total,
			page: result.page,
			totalPages: result.totalPages,
			search,
			role,
		});
	}

	/**
	 * Web UI: Property Listings Administration.
	 */
	static async renderListings(req, res) {
		const { search = "", status = "", page = 1 } = req.query;
		const result = await AdminService.getListings({ search, status, page, limit: 15 });

		res.render("admin/listings.ejs", {
			listings: result.listings,
			total: result.total,
			page: result.page,
			totalPages: result.totalPages,
			search,
			status,
		});
	}

	/**
	 * Web UI: Content Moderation Queue for Flagged Reviews.
	 */
	static async renderModeration(req, res) {
		const flaggedReviews = await AdminService.getFlaggedReviews();
		res.render("admin/moderation.ejs", { flaggedReviews });
	}

	/**
	 * Update User Role (Traveler / Host / Admin).
	 */
	static async updateUserRole(req, res) {
		const { id } = req.params;
		const { role } = req.body;
		const updatedUser = await AdminService.updateUserRole(id, role);

		if (req.originalUrl.startsWith("/api/") || req.xhr || req.headers.accept?.includes("application/json")) {
			return ApiResponse.success(res, updatedUser, `User role updated to ${role}`);
		}

		req.flash("success", `User ${updatedUser.username} role updated to ${role}`);
		res.redirect("/admin/users");
	}

	/**
	 * Toggle Superhost Status for a Host.
	 */
	static async toggleSuperhost(req, res) {
		const { id } = req.params;
		const updatedUser = await AdminService.toggleSuperhost(id);

		if (req.originalUrl.startsWith("/api/") || req.xhr || req.headers.accept?.includes("application/json")) {
			return ApiResponse.success(res, updatedUser, `Superhost status toggled: ${updatedUser.isSuperhost}`);
		}

		req.flash(
			"success",
			`Superhost status ${updatedUser.isSuperhost ? "granted to" : "revoked from"} ${updatedUser.username}`,
		);
		res.redirect("/admin/users");
	}

	/**
	 * Dismiss Flag on Review (Mark approved).
	 */
	static async dismissReviewFlag(req, res) {
		const { id } = req.params;
		const review = await AdminService.dismissReviewFlag(id);

		if (req.originalUrl.startsWith("/api/") || req.xhr || req.headers.accept?.includes("application/json")) {
			return ApiResponse.success(res, review, "Review flag dismissed");
		}

		req.flash("success", "Review flag dismissed and approved.");
		res.redirect("/admin/moderation");
	}

	/**
	 * Remove a Flagged Review Permanently.
	 */
	static async deleteReview(req, res) {
		const { id } = req.params;
		await AdminService.deleteReview(id);

		if (req.originalUrl.startsWith("/api/") || req.xhr || req.headers.accept?.includes("application/json")) {
			return ApiResponse.success(res, null, "Review removed by administrator");
		}

		req.flash("success", "Inappropriate review removed from platform.");
		res.redirect("/admin/moderation");
	}

	/**
	 * Toggle Listing Publishing Status (Draft vs Published).
	 */
	static async toggleListingStatus(req, res) {
		const { id } = req.params;
		const listing = await AdminService.toggleListingStatus(id);

		if (req.originalUrl.startsWith("/api/") || req.xhr || req.headers.accept?.includes("application/json")) {
			return ApiResponse.success(res, listing, `Listing status updated to ${listing.status}`);
		}

		req.flash("success", `Listing status changed to ${listing.status}`);
		res.redirect("/admin/listings");
	}

	/**
	 * Delete a Listing Permanently as Administrator.
	 */
	static async deleteListing(req, res) {
		const { id } = req.params;
		await AdminService.deleteListing(id);

		if (req.originalUrl.startsWith("/api/") || req.xhr || req.headers.accept?.includes("application/json")) {
			return ApiResponse.success(res, null, "Listing deleted by administrator");
		}

		req.flash("success", "Listing removed from platform.");
		res.redirect("/admin/listings");
	}

	/**
	 * REST API: Platform Overview Metrics.
	 */
	static async apiOverview(req, res) {
		const metrics = await AdminService.getPlatformMetrics();
		return ApiResponse.success(res, metrics);
	}

	/**
	 * REST API: User Directory.
	 */
	static async apiUsers(req, res) {
		const { search, role, page, limit } = req.query;
		const result = await AdminService.getUsers({ search, role, page, limit });
		return ApiResponse.success(res, result);
	}

	/**
	 * REST API: Flagged Content Moderation Queue.
	 */
	static async apiFlaggedReviews(req, res) {
		const flaggedReviews = await AdminService.getFlaggedReviews();
		return ApiResponse.success(res, flaggedReviews);
	}

	/**
	 * REST API: Listings Management.
	 */
	static async apiListings(req, res) {
		const { search, status, page, limit } = req.query;
		const result = await AdminService.getListings({ search, status, page, limit });
		return ApiResponse.success(res, result);
	}
}

module.exports = AdminController;

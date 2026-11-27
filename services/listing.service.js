const mongoose = require("mongoose");
const Listing = require("../models/listing");
const {
	cleanupLocalFile,
	persistUploadedFiles,
	deleteStoredAsset,
	MAX_LISTING_IMAGES,
} = require("../config/storage");
const { geocodeLocation, geocodeAddress } = require("../utils/geocoder");
const AppError = require("../utils/AppError");

class ListingService {
	/**
	 * Build comprehensive MongoDB filter from search & discovery criteria
	 */
	static buildQueryFilter(criteria = {}) {
		const filter = {};
		const andConditions = [];
		const viewer = criteria.viewer || null;
		const isAdmin = Boolean(viewer && viewer.role === "admin");

		// 1. Text / Multi-keyword search
		if (typeof criteria.q === "string" && criteria.q.trim()) {
			const rawQuery = criteria.q.trim();
			// Split multi-keyword search
			const keywords = rawQuery
				.split(/\s+/)
				.filter((k) => k.length > 0)
				.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")); // sanitize regex

			if (keywords.length > 0) {
				// Match every keyword across title, location, country, description, or propertyType
				const keywordConditions = keywords.map((word) => {
					const regex = new RegExp(word, "i");
					return {
						$or: [
							{ title: regex },
							{ location: regex },
							{ country: regex },
							{ description: regex },
							{ propertyType: regex },
						],
					};
				});
				andConditions.push(...keywordConditions);
			}
		}

		// 2. Category Filter
		if (typeof criteria.category === "string" && criteria.category && criteria.category !== "All") {
			andConditions.push({ category: criteria.category });
		}

		// 3. Property Type Filter
		if (typeof criteria.propertyType === "string" && criteria.propertyType && criteria.propertyType !== "All") {
			andConditions.push({ propertyType: criteria.propertyType });
		}

		// 4. Status Filter (never expose draft/archived listings to non-owners)
		if (typeof criteria.status === "string" && criteria.status && criteria.status !== "All") {
			if (criteria.status === "published") {
				andConditions.push({ status: "published" });
			} else if (isAdmin) {
				andConditions.push({ status: criteria.status });
			} else if (viewer && viewer._id) {
				andConditions.push({ status: criteria.status, owner: viewer._id });
			} else {
				andConditions.push({ _id: { $in: [] } });
			}
		} else if (!criteria.includeDrafts) {
			andConditions.push({ status: { $nin: ["draft", "archived"] } });
		} else if (!isAdmin) {
			if (viewer && viewer._id) {
				andConditions.push({
					$or: [
						{ status: { $nin: ["draft", "archived"] } },
						{ owner: viewer._id, status: { $ne: "archived" } },
					],
				});
			} else {
				andConditions.push({ status: { $nin: ["draft", "archived"] } });
			}
		}

		// 5. Price Range (Min & Max Price)
		if (
			criteria.minPrice !== undefined &&
			criteria.minPrice !== "" &&
			!isNaN(criteria.minPrice)
		) {
			const min = Number(criteria.minPrice);
			andConditions.push({ price: { $gte: min } });
		}

		if (
			criteria.maxPrice !== undefined &&
			criteria.maxPrice !== "" &&
			!isNaN(criteria.maxPrice)
		) {
			const max = Number(criteria.maxPrice);
			andConditions.push({ price: { $lte: max } });
		}

		// 6. Bedrooms
		if (
			criteria.bedrooms &&
			!isNaN(criteria.bedrooms) &&
			Number(criteria.bedrooms) > 0
		) {
			andConditions.push({ bedrooms: { $gte: Number(criteria.bedrooms) } });
		}

		// 7. Bathrooms
		if (
			criteria.bathrooms &&
			!isNaN(criteria.bathrooms) &&
			Number(criteria.bathrooms) > 0
		) {
			andConditions.push({ bathrooms: { $gte: Number(criteria.bathrooms) } });
		}

		// 8. Guest Capacity
		if (
			criteria.guests &&
			!isNaN(criteria.guests) &&
			Number(criteria.guests) > 0
		) {
			andConditions.push({ guests: { $gte: Number(criteria.guests) } });
		}

		// 9. Amenities (All selected amenities must be present)
		if (criteria.amenities) {
			const amenityList = Array.isArray(criteria.amenities)
				? criteria.amenities.filter((a) => typeof a === "string").map((a) => a.trim()).filter(Boolean)
				: typeof criteria.amenities === "string"
					? criteria.amenities.split(",").map((a) => a.trim()).filter(Boolean)
					: [];

			if (amenityList.length > 0) {
				andConditions.push({ amenities: { $all: amenityList } });
			}
		}

		// 10. Minimum Rating
		if (
			criteria.rating &&
			!isNaN(criteria.rating) &&
			Number(criteria.rating) > 0
		) {
			andConditions.push({ avgRating: { $gte: Number(criteria.rating) } });
		}

		if (andConditions.length > 0) {
			filter.$and = andConditions;
		}

		return filter;
	}

	/**
	 * Build Mongoose sort options
	 */
	static buildSortOption(sortKey = "recommended") {
		switch (sortKey) {
			case "price_asc":
				return { price: 1, _id: -1 };
			case "price_desc":
				return { price: -1, _id: -1 };
			case "newest":
				return { createdAt: -1, _id: -1 };
			case "rating":
				return { avgRating: -1, _id: -1 };
			case "views":
				return { views: -1, _id: -1 };
			case "recommended":
			default:
				return { _id: -1 };
		}
	}

	/**
	 * Find listings with comprehensive filtering, sorting, and server-side pagination
	 */
	static async findListings(criteria = {}) {
		const filter = this.buildQueryFilter(criteria);
		const sort = this.buildSortOption(criteria.sort);

		const page = Math.max(1, parseInt(criteria.page, 10) || 1);
		const limit = Math.max(1, Math.min(50, parseInt(criteria.limit, 10) || 9));
		const skip = (page - 1) * limit;

		// Execute total count & paginated query in parallel
		const [totalListings, listings] = await Promise.all([
			Listing.countDocuments(filter),
			Listing.find(filter)
				.sort(sort)
				.skip(skip)
				.limit(limit)
				.lean()
				.exec(),
		]);

		const totalPages = Math.ceil(totalListings / limit) || 1;

		// Auto-correct geometry if coordinates are default New Delhi placeholder for a non-Delhi location
		listings.forEach((l) => {
			const isDelhi = (l.location || "").toLowerCase().includes("delhi") || (l.country || "").toLowerCase().includes("delhi");
			const isPlaceholder = l.geometry && l.geometry.coordinates &&
				Math.abs(Number(l.geometry.coordinates[0]) - 77.209) < 0.005 &&
				Math.abs(Number(l.geometry.coordinates[1]) - 28.6139) < 0.005 &&
				!isDelhi;

			if (isPlaceholder || !l.geometry || !l.geometry.coordinates || l.geometry.coordinates.length < 2) {
				l.geometry = {
					type: "Point",
					coordinates: geocodeLocation(l.location, l.country),
				};
			}
		});

		return {
			listings,
			pagination: {
				currentPage: page,
				totalPages,
				totalListings,
				limit,
				hasNextPage: page < totalPages,
				hasPrevPage: page > 1,
				nextPage: page < totalPages ? page + 1 : null,
				prevPage: page > 1 ? page - 1 : null,
			},
			filters: {
				q: typeof criteria.q === "string" ? criteria.q : "",
				checkIn: typeof criteria.checkIn === "string" ? criteria.checkIn : "",
				checkOut: typeof criteria.checkOut === "string" ? criteria.checkOut : "",
				category: typeof criteria.category === "string" ? criteria.category : "All",
				propertyType: typeof criteria.propertyType === "string" ? criteria.propertyType : "All",
				status: typeof criteria.status === "string" ? criteria.status : "All",
				minPrice: typeof criteria.minPrice === "string" || typeof criteria.minPrice === "number" ? criteria.minPrice : "",
				maxPrice: typeof criteria.maxPrice === "string" || typeof criteria.maxPrice === "number" ? criteria.maxPrice : "",
				bedrooms: typeof criteria.bedrooms === "string" || typeof criteria.bedrooms === "number" ? criteria.bedrooms : "",
				bathrooms: typeof criteria.bathrooms === "string" || typeof criteria.bathrooms === "number" ? criteria.bathrooms : "",
				guests: typeof criteria.guests === "string" || typeof criteria.guests === "number" ? criteria.guests : "",
				amenities: Array.isArray(criteria.amenities) || typeof criteria.amenities === "string" ? criteria.amenities : [],
				rating: typeof criteria.rating === "string" || typeof criteria.rating === "number" ? criteria.rating : "",
				sort: typeof criteria.sort === "string" ? criteria.sort : "recommended",
			},
		};
	}

	/**
	 * Provide instant debounced autocomplete suggestions based on location, country, and title
	 */
	static async getSearchSuggestions(query = "") {
		if (typeof query !== "string" || query.trim().length < 2) {
			return [];
		}

		const cleanQuery = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const regex = new RegExp(cleanQuery, "i");

		const matches = await Listing.find({
			status: { $nin: ["draft", "archived"] },
			$or: [{ location: regex }, { country: regex }, { title: regex }],
		})
			.select("title location country propertyType")
			.limit(8)
			.lean()
			.exec();

		const suggestions = new Map();

		matches.forEach((item) => {
			if (item.location && regex.test(item.location)) {
				const key = `loc:${item.location.toLowerCase()}`;
				if (!suggestions.has(key)) {
					suggestions.set(key, {
						type: "location",
						text: `${item.location}, ${item.country}`,
						query: item.location,
					});
				}
			}
			if (item.country && regex.test(item.country)) {
				const key = `country:${item.country.toLowerCase()}`;
				if (!suggestions.has(key)) {
					suggestions.set(key, {
						type: "country",
						text: item.country,
						query: item.country,
					});
				}
			}
			if (item.title && regex.test(item.title)) {
				const key = `title:${item.title.toLowerCase()}`;
				if (!suggestions.has(key)) {
					suggestions.set(key, {
						type: "property",
						text: item.title,
						query: item.title,
					});
				}
			}
		});

		// Return up to 6 deduplicated suggestions
		return Array.from(suggestions.values()).slice(0, 6);
	}

	/**
	 * Find listing by ID with populated reviews, authors, and owner.
	 */
	static async getListingById(
		id,
		{ populateReviews = true, populateOwner = true, incrementView = false, viewer = null } = {},
	) {
		if (!mongoose.Types.ObjectId.isValid(id)) {
			throw AppError.notFound("Invalid listing ID format");
		}

		let query = Listing.findById(id);

		if (populateReviews) {
			query = query.populate({
				path: "reviews",
				populate: [
					{ path: "author", select: "username avatar fullName" },
					{ path: "hostReply.author", select: "username avatar fullName" },
				],
			});
		}

		if (populateOwner) {
			query = query.populate("owner", "username avatar fullName isSuperhost");
		}

		const listing = await query.exec();
		if (!listing) {
			throw AppError.notFound("Listing does not exist");
		}

		if (listing.status === "draft" || listing.status === "archived") {
			const ownerId =
				listing.owner && listing.owner._id ? listing.owner._id : listing.owner;
			const isOwnerViewer =
				viewer && ownerId && String(ownerId) === String(viewer._id);
			const isAdminViewer = viewer && viewer.role === "admin";
			if (!isOwnerViewer && !isAdminViewer) {
				throw AppError.notFound("Listing does not exist");
			}
		}

		// Atomically increment views count only after existence & visibility check
		if (incrementView) {
			await Listing.findByIdAndUpdate(id, { $inc: { views: 1 } });
		}

		// Ensure images array is synthesized if missing for backwards compatibility
		if (
			(!listing.images || listing.images.length === 0) &&
			listing.image &&
			listing.image.url
		) {
			listing.images = [
				{
					url: listing.image.url,
					filename: listing.image.filename || "default",
					isPrimary: true,
				},
			];
		}

		// Auto-correct geometry if listing has default Delhi placeholder coordinates for a non-Delhi location
		const isDelhi = (listing.location || "").toLowerCase().includes("delhi") || (listing.country || "").toLowerCase().includes("delhi");
		const isPlaceholder = listing.geometry && listing.geometry.coordinates &&
			Math.abs(Number(listing.geometry.coordinates[0]) - 77.209) < 0.005 &&
			Math.abs(Number(listing.geometry.coordinates[1]) - 28.6139) < 0.005 &&
			!isDelhi;

		if (isPlaceholder || !listing.geometry || !listing.geometry.coordinates || listing.geometry.coordinates.length < 2) {
			listing.geometry = {
				type: "Point",
				coordinates: geocodeLocation(listing.location, listing.country),
			};
		}

		return listing;
	}

	/**
	 * Create a new property listing with multi-image gallery & geocoding.
	 */
	static async createListing(listingData, filesOrFile, user) {
		const payload = { ...listingData };

		// Normalize amenities
		if (typeof payload.amenities === "string") {
			payload.amenities = payload.amenities
				.split(",")
				.map((a) => a.trim())
				.filter(Boolean);
		}

		// Auto-populate GeoJSON geometry dynamically based on address entered
		if (
			!payload.geometry ||
			!payload.geometry.coordinates ||
			payload.geometry.coordinates.length < 2
		) {
			const coords = await geocodeAddress(payload.location, payload.country);
			payload.geometry = {
				type: "Point",
				coordinates: coords,
			};
		}

		// Process single or multiple uploaded files
		const files = Array.isArray(filesOrFile)
			? filesOrFile
			: filesOrFile
				? [filesOrFile]
				: [];

		if (files.length > MAX_LISTING_IMAGES) {
			for (const file of files) {
				if (file && file.filename) cleanupLocalFile(file.filename);
			}
			throw AppError.badRequest(
				`Maximum ${MAX_LISTING_IMAGES} photos are allowed per listing.`,
			);
		}

		let storedImages = [];
		if (files.length > 0) {
			storedImages = await persistUploadedFiles(files, { folder: "wonderlust/listings" });
			payload.images = storedImages.map((img, idx) => ({
				url: img.url,
				filename: img.filename,
				isPrimary: idx === 0,
			}));
			payload.image = {
				url: storedImages[0].url,
				filename: storedImages[0].filename,
			};
		} else if (!payload.image || !payload.image.url) {
			const defaultImg = {
				url: "https://images.unsplash.com/photo-1552733407-5d5c46c3bb3b?auto=format&fit=crop&w=800&q=60",
				filename: "default-listing",
				isPrimary: true,
			};
			payload.image = defaultImg;
			payload.images = [defaultImg];
		} else {
			payload.images = [
				{
					url: payload.image.url,
					filename: payload.image.filename || "default",
					isPrimary: true,
				},
			];
		}

		const listing = new Listing(payload);
		listing.owner = user._id;

		try {
			return await listing.save();
		} catch (err) {
			await Promise.all(storedImages.map((img) => deleteStoredAsset(img)));
			throw err;
		}
	}

	/**
	 * Update an existing property listing with multi-image append & geocoding.
	 */
	static async updateListing(id, updateData, filesOrFile) {
		if (!mongoose.Types.ObjectId.isValid(id)) {
			throw AppError.notFound("Invalid listing ID");
		}

		const listing = await Listing.findById(id);
		if (!listing) {
			throw AppError.notFound("Listing not found");
		}

		const payload = { ...updateData };

		// Normalize amenities
		if (typeof payload.amenities === "string") {
			payload.amenities = payload.amenities
				.split(",")
				.map((a) => a.trim())
				.filter(Boolean);
		}

		// Re-geocode dynamically if location or country changed
		if (payload.location || payload.country) {
			const loc = payload.location || listing.location;
			const ctry = payload.country || listing.country;
			const coords = await geocodeAddress(loc, ctry);
			payload.geometry = {
				type: "Point",
				coordinates: coords,
			};
		}

		// Process new uploaded files
		const newFiles = Array.isArray(filesOrFile)
			? filesOrFile
			: filesOrFile
				? [filesOrFile]
				: [];

		let newlyStored = [];
		if (newFiles.length > 0) {
			const existingCount = Array.isArray(listing.images) ? listing.images.length : 0;
			if (existingCount + newFiles.length > MAX_LISTING_IMAGES) {
				for (const file of newFiles) {
					if (file && file.filename) cleanupLocalFile(file.filename);
				}
				throw AppError.badRequest(
					`Gallery can contain at most ${MAX_LISTING_IMAGES} photos (currently ${existingCount}).`,
				);
			}

			newlyStored = await persistUploadedFiles(newFiles, { folder: "wonderlust/listings" });
			const newImages = newlyStored.map((img, idx) => ({
				url: img.url,
				filename: img.filename,
				isPrimary: (!listing.images || listing.images.length === 0) && idx === 0,
			}));

			listing.images = listing.images || [];
			listing.images.push(...newImages);

			// Update primary image if current is default
			if (
				!listing.image ||
				!listing.image.url ||
				listing.image.filename === "default-listing"
			) {
				listing.image = {
					url: newlyStored[0].url,
					filename: newlyStored[0].filename,
				};
			}
		}

		// Apply remaining updates
		Object.assign(listing, payload);

		try {
			return await listing.save();
		} catch (err) {
			await Promise.all(newlyStored.map((img) => deleteStoredAsset(img)));
			throw err;
		}
	}

	/**
	 * Remove a specific image from a listing gallery & cleanup local file.
	 */
	static async deleteListingImage(listingId, imageIdentifier) {
		if (!mongoose.Types.ObjectId.isValid(listingId)) {
			throw AppError.notFound("Invalid listing ID");
		}

		const listing = await Listing.findById(listingId);
		if (!listing) {
			throw AppError.notFound("Listing not found");
		}

		// Find target image by _id or filename
		const imgIndex = listing.images.findIndex(
			(img) =>
				String(img._id) === String(imageIdentifier) ||
				img.filename === imageIdentifier,
		);

		if (imgIndex !== -1) {
			const [removed] = listing.images.splice(imgIndex, 1);
			if (removed.filename) {
				await deleteStoredAsset(removed);
			}

			// If removed image was primary, assign first remaining image as primary
			if (removed.isPrimary && listing.images.length > 0) {
				listing.images[0].isPrimary = true;
				listing.image = {
					url: listing.images[0].url,
					filename: listing.images[0].filename,
				};
			}
		}

		return await listing.save();
	}

	/**
	 * Designate a specific gallery image as the primary listing thumbnail.
	 */
	static async setPrimaryImage(listingId, imageIdentifier) {
		if (!mongoose.Types.ObjectId.isValid(listingId)) {
			throw AppError.notFound("Invalid listing ID");
		}

		const listing = await Listing.findById(listingId);
		if (!listing) {
			throw AppError.notFound("Listing not found");
		}

		let primaryFound = false;
		for (const img of listing.images) {
			if (
				String(img._id) === String(imageIdentifier) ||
				img.filename === imageIdentifier
			) {
				img.isPrimary = true;
				listing.image = {
					url: img.url,
					filename: img.filename,
				};
				primaryFound = true;
			} else {
				img.isPrimary = false;
			}
		}

		if (!primaryFound) {
			throw AppError.notFound("Image not found in gallery");
		}

		return await listing.save();
	}

	/**
	 * Delete a listing and remove its local image assets.
	 */
	static async deleteListing(id) {
		if (!mongoose.Types.ObjectId.isValid(id)) {
			throw AppError.notFound("Invalid listing ID");
		}

		const listing = await Listing.findByIdAndDelete(id);
		if (!listing) {
			throw AppError.notFound("Listing not found");
		}

		return listing;
	}
}

module.exports = ListingService;

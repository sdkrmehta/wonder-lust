const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const Review = require("./review.js");
const { cleanupLocalFile } = require("../config/storage");

const listingSchema = new Schema(
	{
		title: {
			type: String,
			required: [true, "Listing title is required"],
			trim: true,
		},
		description: {
			type: String,
			required: [true, "Listing description is required"],
			trim: true,
		},
		// Primary image for backward compatibility
		image: {
			url: {
				type: String,
				default: "/assets/default-listing.jpg",
			},
			filename: {
				type: String,
				default: "listingimage",
			},
		},
		// Multi-image gallery support
		images: [
			{
				url: { type: String, required: true },
				filename: { type: String, default: "" },
				isPrimary: { type: Boolean, default: false },
			},
		],
		price: {
			type: Number,
			required: [true, "Listing price is required"],
			min: [0, "Price must be a positive value"],
		},
		location: {
			type: String,
			required: [true, "Location is required"],
			trim: true,
		},
		country: {
			type: String,
			required: [true, "Country is required"],
			trim: true,
		},
		geometry: {
			type: {
				type: String,
				enum: ["Point"],
				default: "Point",
			},
			coordinates: {
				type: [Number],
				default: [77.209, 28.6139], // [longitude, latitude]
			},
		},
		category: {
			type: String,
			enum: [
				"Trending",
				"Rooms",
				"Iconic Cities",
				"Mountains",
				"Castles",
				"Amazing Pools",
				"Camping",
				"Farms",
				"Arctic",
				"Domes",
				"Boats",
				"General",
			],
			default: "General",
		},
		propertyType: {
			type: String,
			enum: [
				"Villa",
				"Apartment",
				"House",
				"Cabin",
				"Cottage",
				"Beachfront",
				"Farmhouse",
				"Hotel",
				"Room",
				"Other",
			],
			default: "Villa",
		},
		status: {
			type: String,
			enum: ["published", "draft", "archived"],
			default: "published",
		},
		views: {
			type: Number,
			default: 0,
			min: 0,
		},
		bedrooms: {
			type: Number,
			default: 1,
			min: [0, "Bedrooms cannot be negative"],
		},
		bathrooms: {
			type: Number,
			default: 1,
			min: [0, "Bathrooms cannot be negative"],
		},
		guests: {
			type: Number,
			default: 2,
			min: [1, "Guest capacity must be at least 1"],
		},
		amenities: {
			type: [String],
			default: ["Wifi", "Air Conditioning", "Free Parking"],
		},
		avgRating: {
			type: Number,
			default: 0,
			min: 0,
			max: 5,
		},
		ratingBreakdown: {
			cleanliness: { type: Number, default: 0 },
			accuracy: { type: Number, default: 0 },
			communication: { type: Number, default: 0 },
			location: { type: Number, default: 0 },
			checkIn: { type: Number, default: 0 },
			value: { type: Number, default: 0 },
			stars: {
				1: { type: Number, default: 0 },
				2: { type: Number, default: 0 },
				3: { type: Number, default: 0 },
				4: { type: Number, default: 0 },
				5: { type: Number, default: 0 },
			},
		},
		reviews: [
			{
				type: Schema.Types.ObjectId,
				ref: "Review",
			},
		],
		owner: {
			type: Schema.Types.ObjectId,
			ref: "User",
		},
		externalId: {
			type: String,
			index: true,
		},
	},
	{ timestamps: true },
);

// Compound Text Index for High-Relevance Discovery
listingSchema.index(
	{
		title: "text",
		location: "text",
		country: "text",
		description: "text",
	},
	{
		weights: {
			title: 10,
			location: 8,
			country: 6,
			description: 2,
		},
		name: "ListingTextIndex",
	},
);

// High-performance filter & sort indexes
listingSchema.index({ price: 1 });
listingSchema.index({ category: 1 });
listingSchema.index({ propertyType: 1 });
listingSchema.index({ status: 1 });
listingSchema.index({ status: 1, category: 1, price: 1 });
listingSchema.index({ status: 1, price: 1 });
listingSchema.index({ guests: 1 });
listingSchema.index({ views: -1 });
listingSchema.index({ createdAt: -1 });
listingSchema.index({ location: 1, country: 1 });
listingSchema.index({ owner: 1 });
listingSchema.index({ owner: 1, createdAt: -1 });
listingSchema.index({ geometry: "2dsphere" });

// Cascade delete reviews & local images when a listing is deleted
listingSchema.post("findOneAndDelete", async (listing) => {
	if (listing) {
		// Clean up primary image file
		if (listing.image && listing.image.filename) {
			cleanupLocalFile(listing.image.filename);
		}
		// Clean up gallery images
		if (listing.images && listing.images.length) {
			for (const img of listing.images) {
				if (img.filename) {
					cleanupLocalFile(img.filename);
				}
			}
		}
		// Clean up reviews
		if (listing.reviews && listing.reviews.length) {
			await Review.deleteMany({ _id: { $in: listing.reviews } });
		}
	}
});

const Listing = mongoose.model("Listing", listingSchema);
module.exports = Listing;

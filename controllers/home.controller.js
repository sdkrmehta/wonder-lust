const mongoose = require("mongoose");
const Listing = require("../models/listing");

/**
 * Curated Global and Indian Destinations
 * Matches Section 5 Requirements: Bali, Dubai, London, New York, Bangkok,
 * Paris, Switzerland, Singapore, Maldives, Goa, Manali, Jaipur, Kashmir,
 * Kerala, Shimla, Udaipur, Darjeeling.
 */
const CURATED_DESTINATIONS = [
	// International Destinations
	{
		id: "bali",
		name: "Bali",
		country: "Indonesia",
		region: "International",
		tag: "Tropical Paradise",
		category: "Beaches",
		image: "https://images.unsplash.com/photo-1537996194471-e657df975ab4?auto=format&fit=crop&w=800&q=80",
		description: "Terraced rice paddies, serene beaches, and sacred Hindu temples nestled in lush greenery.",
		badge: "Popular",
	},
	{
		id: "dubai",
		name: "Dubai",
		country: "UAE",
		region: "International",
		tag: "Modern Luxury",
		category: "Iconic Cities",
		image: "https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=800&q=80",
		description: "Futuristic architecture, ultra-luxury shopping, and golden desert dune adventures.",
		badge: "Trending",
	},
	{
		id: "london",
		name: "London",
		country: "United Kingdom",
		region: "International",
		tag: "Historic Elegance",
		category: "Iconic Cities",
		image: "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?auto=format&fit=crop&w=800&q=80",
		description: "World-class museums, timeless royal landmarks, and vibrant cosmopolitan dining.",
		badge: "Classic",
	},
	{
		id: "new-york",
		name: "New York",
		country: "United States",
		region: "International",
		tag: "Urban Marvel",
		category: "Iconic Cities",
		image: "https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?auto=format&fit=crop&w=800&q=80",
		description: "The iconic skyline, Broadway spectacles, Central Park walks, and endless culinary energy.",
		badge: "Top Pick",
	},
	{
		id: "bangkok",
		name: "Bangkok",
		country: "Thailand",
		region: "International",
		tag: "Cultural Tapestry",
		category: "Iconic Cities",
		image: "https://images.unsplash.com/photo-1508009603885-50cf7c579365?auto=format&fit=crop&w=800&q=80",
		description: "Intricately adorned shrines, energetic floating markets, and celebrated street gastronomy.",
		badge: "Must Visit",
	},
	{
		id: "paris",
		name: "Paris",
		country: "France",
		region: "International",
		tag: "Art & Romance",
		category: "Iconic Cities",
		image: "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=800&q=80",
		description: "The City of Light, famous for haute couture, the Seine riverbank, and Louvre treasures.",
		badge: "Romantic",
	},
	{
		id: "switzerland",
		name: "Switzerland",
		country: "Switzerland",
		region: "International",
		tag: "Alpine Majesty",
		category: "Mountains",
		image: "https://images.unsplash.com/photo-1530122037265-a5f1f91d3b99?auto=format&fit=crop&w=800&q=80",
		description: "Glacial lakes, snow-draped alpine peaks, picturesque chalets, and scenic mountain railways.",
		badge: "Scenic",
	},
	{
		id: "singapore",
		name: "Singapore",
		country: "Singapore",
		region: "International",
		tag: "Garden City",
		category: "Iconic Cities",
		image: "https://images.unsplash.com/photo-1525625293386-3f8f99389edd?auto=format&fit=crop&w=800&q=80",
		description: "Futuristic supertrees, Marina Bay waterfront, Michelin hawker feasts, and botanical beauty.",
		badge: "Urban Oasis",
	},
	{
		id: "maldives",
		name: "Maldives",
		country: "Maldives",
		region: "International",
		tag: "Coral Atolls",
		category: "Beaches",
		image: "https://images.unsplash.com/photo-1514282401047-d79a71a590e8?auto=format&fit=crop&w=800&q=80",
		description: "Overwater private villas, turquoise lagoons, vibrant coral reefs, and tranquil sunsets.",
		badge: "Exclusive",
	},
	// Indian Destinations
	{
		id: "goa",
		name: "Goa",
		country: "India",
		region: "India",
		tag: "Sun, Sand & Heritage",
		category: "Beaches",
		image: "https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?auto=format&fit=crop&w=800&q=80",
		description: "Sun-drenched palm beaches, Portuguese heritage architecture, vibrant cafes, and coastal breezes.",
		badge: "Top Beach",
	},
	{
		id: "manali",
		name: "Manali",
		country: "India",
		region: "India",
		tag: "Himalayan Haven",
		category: "Mountains",
		image: "https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?auto=format&fit=crop&w=800&q=80",
		description: "Crisp mountain air, deodar forests, Rohtang snow passes, and serene riversides.",
		badge: "Adventure",
	},
	{
		id: "jaipur",
		name: "Jaipur",
		country: "India",
		region: "India",
		tag: "Pink City Grandeur",
		category: "Castles",
		image: "https://images.unsplash.com/photo-1603262110263-fb010d6e59d4?auto=format&fit=crop&w=800&q=80",
		description: "Hawa Mahal, opulent royal palaces, Amber Fort ramparts, and historic Rajasthani bazaars.",
		badge: "Heritage",
	},
	{
		id: "kashmir",
		name: "Kashmir",
		country: "India",
		region: "India",
		tag: "Paradise on Earth",
		category: "Mountains",
		image: "https://images.unsplash.com/photo-1595815771614-ade9d652a65d?auto=format&fit=crop&w=800&q=80",
		description: "Dal Lake shikaras, blossoming Mughal gardens, snow meadows of Gulmarg, and chinar trees.",
		badge: "Scenic Wonder",
	},
	{
		id: "kerala",
		name: "Kerala",
		country: "India",
		region: "India",
		tag: "God's Own Country",
		category: "Amazing Pools",
		image: "https://images.unsplash.com/photo-1602216056096-3b40cc0c9944?auto=format&fit=crop&w=800&q=80",
		description: "Lush backwater houseboats, Munnar tea hills, Ayurvedic retreats, and coastal tranquility.",
		badge: "Wellness",
	},
	{
		id: "shimla",
		name: "Shimla",
		country: "India",
		region: "India",
		tag: "Colonial Ridge",
		category: "Mountains",
		image: "https://images.unsplash.com/photo-1562670652-e5947bddb335?auto=format&fit=crop&w=800&q=80",
		description: "Pine-clad hills, the historic Mall Road, toy train journeys, and panoramic valley views.",
		badge: "Charming",
	},
	{
		id: "udaipur",
		name: "Udaipur",
		country: "India",
		region: "India",
		tag: "City of Lakes",
		category: "Castles",
		image: "https://images.unsplash.com/photo-1599661046289-e31897846e41?auto=format&fit=crop&w=800&q=80",
		description: "Lake Pichola palaces, sunset boat rides, marble courtyards, and royal Mewar heritage.",
		badge: "Romantic",
	},
	{
		id: "darjeeling",
		name: "Darjeeling",
		country: "India",
		region: "India",
		tag: "Queen of the Hills",
		category: "Mountains",
		image: "https://images.unsplash.com/photo-1544735716-392fe2489ffa?auto=format&fit=crop&w=800&q=80",
		description: "World-famous emerald tea estates, Kanchenjunga sunrise views, and vintage toy trains.",
		badge: "Serene",
	},
];

/**
 * Curated Travel Experiences (Section 7)
 */
const TRAVEL_EXPERIENCES = [
	{
		id: "beach",
		title: "Beach Holidays",
		description: "Sun-drenched coastlines, golden sands, and private waterfront bungalows.",
		image: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80",
		categoryFilter: "Amazing Pools",
		query: "Beach",
	},
	{
		id: "mountains",
		title: "Mountain Adventures",
		description: "Alpine trails, misty pine valleys, and cozy log cabins with panoramic vistas.",
		image: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=800&q=80",
		categoryFilter: "Mountains",
		query: "Mountain",
	},
	{
		id: "luxury",
		title: "Luxury Travel",
		description: "Five-star secluded villas, personal concierge service, and opulent amenities.",
		image: "https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=800&q=80",
		categoryFilter: "Trending",
		query: "Luxury",
	},
	{
		id: "wildlife",
		title: "Wildlife & Nature",
		description: "Eco-lodges nestled in national parks, safari retreats, and untouched forest sanctuaries.",
		image: "https://images.unsplash.com/photo-1516426122078-c23e76319801?auto=format&fit=crop&w=800&q=80",
		categoryFilter: "Camping",
		query: "Nature",
	},
	{
		id: "historical",
		title: "Historical Places",
		description: "Centuries-old castles, UNESCO heritage monuments, and grand architectural estates.",
		image: "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?auto=format&fit=crop&w=800&q=80",
		categoryFilter: "Castles",
		query: "Historic",
	},
	{
		id: "romantic",
		title: "Romantic Getaways",
		description: "Intimate boutique escapes, private sunsets, starlit domes, and honeymoon sanctuaries.",
		image: "https://images.unsplash.com/photo-1518684079-3c830dcef090?auto=format&fit=crop&w=800&q=80",
		categoryFilter: "Rooms",
		query: "Romantic",
	},
];

/**
 * Curated Special Offers (Section 8)
 */
const SPECIAL_OFFERS = [
	{
		id: "early-bird",
		title: "Early Bird Summer Escapes",
		discount: "Save up to 20%",
		description: "Book your villa or hotel stay 30 days in advance and unlock special seasonal rates across prime locations.",
		image: "https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?auto=format&fit=crop&w=800&q=80",
		tag: "Early Booking",
		validity: "Valid for stays booked 30+ days ahead",
	},
	{
		id: "weekend-staycation",
		title: "Weekend Getaway Perks",
		discount: "Complimentary Breakfast",
		description: "Recharge close to home with late check-out privileges, artisan breakfast baskets, and pool access.",
		image: "https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=800&q=80",
		tag: "Weekend Special",
		validity: "Friday to Sunday stays",
	},
	{
		id: "workation-retreat",
		title: "Extended Stay & Workation",
		discount: "Weekly Rate - 25% Off",
		description: "Combine productivity with inspiration. High-speed fiber WiFi, ergonomic desks, and peaceful grounds.",
		image: "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=800&q=80",
		tag: "Long Stays",
		validity: "Available on 7+ night reservations",
	},
];

/**
 * Curated Testimonials (Section 9)
 */
const TESTIMONIALS = [
	{
		id: 1,
		name: "Aarav Sharma",
		location: "Mumbai, India",
		destination: "Bali, Indonesia",
		avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80",
		rating: 5,
		review: "Wanderlust made our anniversary trip to Bali completely stress-free. The private villa exceeded every expectation, and the verified host was incredibly helpful.",
	},
	{
		id: 2,
		name: "Emily Watson",
		location: "London, UK",
		destination: "Jaipur, India",
		avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&q=80",
		rating: 5,
		review: "The heritage haveli we booked in Jaipur felt like living inside a fairy tale. Seamless booking, transparent pricing, and wonderful local recommendations.",
	},
	{
		id: 3,
		name: "Marcus Vance",
		location: "San Francisco, USA",
		destination: "Swiss Alps, Switzerland",
		avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&q=80",
		rating: 5,
		review: "The mountain chalet had jaw-dropping views of the peaks. Finding a verified retreat with fast WiFi and ski access was effortless on Wanderlust.",
	},
];

/**
 * Curated Fallback Stays (when database is empty or has few listings)
 */
const CURATED_FALLBACK_STAYS = [
	{
		_id: "demo_1",
		title: "Villa Surya Sunset Cliff",
		location: "Uluwatu",
		country: "Indonesia",
		price: 4500,
		avgRating: 4.95,
		reviews: [1, 2, 3, 4],
		propertyType: "Villa",
		amenities: ["Wifi", "Pool", "Air Conditioning", "Free Parking"],
		image: {
			url: "https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=800&q=80",
		},
	},
	{
		_id: "demo_2",
		title: "The Grand Alpine Chalet",
		location: "Zermatt",
		country: "Switzerland",
		price: 6800,
		avgRating: 4.92,
		reviews: [1, 2, 3],
		propertyType: "Cabin",
		amenities: ["Wifi", "Hot Tub", "Kitchen", "Free Parking"],
		image: {
			url: "https://images.unsplash.com/photo-1502784444187-359ac186c5bb?auto=format&fit=crop&w=800&q=80",
		},
	},
	{
		_id: "demo_3",
		title: "Azure Coast Luxury Villa",
		location: "Goa",
		country: "India",
		price: 3800,
		avgRating: 4.88,
		reviews: [1, 2, 3, 4, 5],
		propertyType: "Villa",
		amenities: ["Wifi", "Pool", "Air Conditioning"],
		image: {
			url: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=80",
		},
	},
	{
		_id: "demo_4",
		title: "Manhattan Skyview Penthouse",
		location: "New York",
		country: "United States",
		price: 9200,
		avgRating: 4.96,
		reviews: [1, 2],
		propertyType: "Apartment",
		amenities: ["Wifi", "Air Conditioning", "Dedicated Workspace"],
		image: {
			url: "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=80",
		},
	},
	{
		_id: "demo_5",
		title: "Royal Heritage Haveli",
		location: "Udaipur",
		country: "India",
		price: 5200,
		avgRating: 4.9,
		reviews: [1, 2, 3],
		propertyType: "House",
		amenities: ["Wifi", "Pool", "Air Conditioning", "Free Parking"],
		image: {
			url: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80",
		},
	},
	{
		_id: "demo_6",
		title: "Overwater Coral Lagoon Villa",
		location: "Baa Atoll",
		country: "Maldives",
		price: 12500,
		avgRating: 4.98,
		reviews: [1, 2, 3, 4],
		propertyType: "Beachfront",
		amenities: ["Wifi", "Pool", "Air Conditioning", "Kitchen"],
		image: {
			url: "https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=800&q=80",
		},
	},
];

/**
 * Controller to render the redesigned Wanderlust Homepage
 */
module.exports.renderHome = async (req, res) => {
	let featuredListings = [];
	let totalListingsCount = 0;

	// Query live database if connected; otherwise proceed immediately with curated showcase
	try {
		if (mongoose.connection && mongoose.connection.readyState === 1) {
			featuredListings = await Listing.find({ status: { $ne: "archived" } })
				.sort({ avgRating: -1, _id: -1 })
				.limit(6)
				.lean();

			totalListingsCount = await Listing.countDocuments({ status: { $ne: "archived" } });
		}
	} catch (err) {
		console.warn("Notice: Database query for featured listings fallback active:", err.message);
	}

	// If database has fewer listings, blend with curated fallback stays for a stunning showcase
	if (!featuredListings || featuredListings.length < 3) {
		featuredListings = [...(featuredListings || []), ...CURATED_FALLBACK_STAYS].slice(0, 6);
	}

	// Statistics
	const stats = {
		totalDestinations: "150+",
		availableHotels: totalListingsCount > 0 ? `${totalListingsCount}+` : "3,200+",
		happyTravelers: "48,000+",
		countriesCovered: "35+",
	};

	// Unique countries from destinations list for filter navigation
	const filterCountries = [
		"All",
		"India",
		"Indonesia",
		"Malaysia",
		"Thailand",
		"UAE",
		"United Kingdom",
		"United States",
		"France",
		"Switzerland",
	];

	try {
		res.render("pages/home.ejs", {
			currUser: req.user || res.locals.currUser || null,
			success: res.locals.success || [],
			error: res.locals.error || [],
			isHome: true,
			isFluid: true,
			stats,
			destinations: CURATED_DESTINATIONS,
			filterCountries,
			featuredListings,
			experiences: TRAVEL_EXPERIENCES,
			offers: SPECIAL_OFFERS,
			testimonials: TESTIMONIALS,
		});
	} catch (renderErr) {
		console.error("renderHome template error:", renderErr);
		res.status(500).send("Unable to render homepage. Please try refreshing.");
	}
};

/**
 * Newsletter Subscription Handler
 */
module.exports.handleNewsletter = (req, res) => {
	const { email } = req.body;
	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

	if (!email || !emailRegex.test(email.trim())) {
		return res.status(400).json({
			status: "error",
			message: "Please provide a valid email address.",
		});
	}

	// In a real application, persist to database or email marketing tool
	return res.status(200).json({
		status: "success",
		message: "Thank you for subscribing! Check your inbox for exclusive Wanderlust travel inspiration.",
	});
};

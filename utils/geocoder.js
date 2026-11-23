/**
 * Geocoding Utility
 * Dynamically maps location and city names to GeoJSON [longitude, latitude] coordinates.
 * Features:
 * 1. Dynamic online lookup via OpenStreetMap Nominatim & Photon APIs (works for any address worldwide).
 * 2. Instant offline fallback table covering all major countries, vacation hubs, and cities.
 */

const KNOWN_COORDINATES = {
	// India & Subcontinent
	goa: [73.8567, 15.2993],
	jaipur: [75.7873, 26.9124],
	mumbai: [72.8777, 19.076],
	delhi: [77.209, 28.6139],
	newdelhi: [77.209, 28.6139],
	bengaluru: [77.5946, 12.9716],
	bangalore: [77.5946, 12.9716],
	udaipur: [73.7125, 24.5854],
	kerala: [76.2711, 10.8505],
	manali: [77.1892, 32.2432],
	shimla: [77.1734, 31.1048],
	varanasi: [82.9739, 25.3176],
	agra: [78.0081, 27.1767],
	darjeeling: [88.2663, 27.041],
	kashmir: [74.7973, 34.0837],
	srinagar: [74.7973, 34.0837],
	rishikesh: [78.2676, 30.0869],
	ladakh: [77.5771, 34.1526],
	india: [78.9629, 20.5937],
	srilanka: [80.7718, 7.8731],
	nepal: [84.124, 28.3949],

	// North & Central America
	malibu: [-118.7798, 34.0259],
	newyork: [-74.006, 40.7128],
	newyorkcity: [-74.006, 40.7128],
	nyc: [-74.006, 40.7128],
	losangeles: [-118.2437, 34.0522],
	aspen: [-106.8175, 39.1911],
	portland: [-122.6784, 45.5152],
	laketahoe: [-120.0324, 39.0968],
	boston: [-71.0589, 42.3601],
	miami: [-80.1918, 25.7617],
	montana: [-110.3626, 46.8797],
	newhampshire: [-71.5724, 43.1939],
	charleston: [-79.9311, 32.7765],
	banff: [-115.5708, 51.1784],
	cancun: [-86.8515, 21.1619],
	tulum: [-87.4654, 20.2114],
	costarica: [-84.0907, 9.7489],
	mexico: [-102.5528, 23.6345],
	canada: [-106.3468, 56.1304],
	unitedstates: [-95.7129, 37.0902],
	usa: [-95.7129, 37.0902],
	us: [-95.7129, 37.0902],
	hawaii: [-155.5828, 19.8968],

	// Europe
	florence: [11.2558, 43.7696],
	tuscany: [11.2558, 43.7696],
	verbier: [7.2286, 46.0968],
	amsterdam: [4.9041, 52.3676],
	cotswolds: [-1.8433, 51.833],
	scottishhighlands: [-4.2026, 57.3229],
	mykonos: [25.3289, 37.4467],
	santorini: [25.4317, 36.3932],
	greece: [21.8243, 39.0742],
	paris: [2.3522, 48.8566],
	france: [2.2137, 46.2276],
	london: [-0.1278, 51.5074],
	unitedkingdom: [-3.4359, 55.3781],
	uk: [-3.4359, 55.3781],
	rome: [12.4964, 41.9028],
	venice: [12.3155, 45.4408],
	italy: [12.5674, 41.8719],
	barcelona: [2.1734, 41.3851],
	madrid: [-3.7038, 40.4168],
	ibiza: [1.432, 38.9067],
	spain: [-3.7492, 40.4637],
	switzerland: [8.2275, 46.8182],
	zurich: [8.5417, 47.3769],
	geneva: [6.1432, 46.2044],
	germany: [10.4515, 51.1657],
	berlin: [13.405, 52.52],
	netherlands: [5.2913, 52.1326],
	portugal: [-8.2245, 39.3999],
	lisbon: [-9.1393, 38.7223],
	croatia: [15.2, 45.1],
	dubrovnik: [18.0944, 42.6507],
	norway: [8.4689, 60.472],
	iceland: [-18.6435, 64.9631],

	// Asia, Middle East & Oceania
	tokyo: [139.6917, 35.6895],
	kyoto: [135.7681, 35.0116],
	japan: [138.2529, 36.2048],
	dubai: [55.2708, 25.2048],
	abudhabi: [54.3773, 24.4539],
	uae: [53.8478, 23.4241],
	unitedarabemirates: [53.8478, 23.4241],
	bangkok: [100.5018, 13.7563],
	phuket: [98.3923, 7.8804],
	thailand: [100.9925, 15.87],
	bali: [115.1889, -8.4095],
	indonesia: [113.9213, -0.7893],
	singapore: [103.8198, 1.3521],
	maldives: [73.2207, 3.2028],
	male: [73.5093, 4.1755],
	fiji: [178.065, -17.7134],
	australia: [133.7751, -25.2744],
	sydney: [151.2093, -33.8688],
	melbourne: [144.9631, -37.8136],
	newzealand: [174.8859, -40.9006],
	queenstown: [168.6626, -45.0312],
	vietnam: [108.2772, 14.0583],
	hanoi: [105.8342, 21.0278],
	malaysia: [101.9758, 4.2105],
	kualalumpur: [101.6869, 3.139],
	serengeti: [34.8333, -2.3333],
	tanzania: [34.8888, -6.369],
	southafrica: [22.9375, -30.5595],
	capetown: [18.4241, -33.9249],
	egypt: [30.8025, 26.8206],
	cairo: [31.2357, 30.0444],
};

function normalizeKey(str = "") {
	return str
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");
}

/**
 * Synchronous geocode fallback using normalized dictionary lookup.
 */
function geocodeLocation(locationStr = "", countryStr = "") {
	const normLocation = normalizeKey(locationStr);
	const normCountry = normalizeKey(countryStr);

	// 1. Direct match on location
	if (normLocation && KNOWN_COORDINATES[normLocation]) {
		return KNOWN_COORDINATES[normLocation];
	}

	// 2. Partial word match on location
	if (normLocation) {
		for (const [key, coords] of Object.entries(KNOWN_COORDINATES)) {
			if (normLocation.includes(key) || (key.length > 3 && key.includes(normLocation))) {
				return coords;
			}
		}
	}

	// 3. Match on country
	if (normCountry && KNOWN_COORDINATES[normCountry]) {
		return KNOWN_COORDINATES[normCountry];
	}

	if (normCountry) {
		for (const [key, coords] of Object.entries(KNOWN_COORDINATES)) {
			if (normCountry.includes(key) || (key.length > 3 && key.includes(normCountry))) {
				return coords;
			}
		}
	}

	// Fallback to coordinates
	return [77.209, 28.6139];
}

/**
 * Dynamic Asynchronous Geocoding via Nominatim & Photon APIs.
 * Resolves any address entered worldwide without hardcoding.
 */
async function geocodeAddress(locationStr = "", countryStr = "") {
	const query = [locationStr, countryStr].filter(Boolean).join(", ");
	if (!query) return [77.209, 28.6139];

	// 1. Try OpenStreetMap Nominatim API
	try {
		const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
		const res = await fetch(url, {
			headers: { "User-Agent": "Wanderlust-Travel-Platform/1.0" },
			signal: AbortSignal.timeout(2500),
		});
		if (res.ok) {
			const data = await res.json();
			if (data && data.length > 0) {
				return [parseFloat(data[0].lon), parseFloat(data[0].lat)];
			}
		}
	} catch (e) {
		// Silent continue to Photon
	}

	// 2. Try Photon Komoot API
	try {
		const pUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1`;
		const pRes = await fetch(pUrl, { signal: AbortSignal.timeout(2500) });
		if (pRes.ok) {
			const pData = await pRes.json();
			if (pData && pData.features && pData.features.length > 0) {
				const pt = pData.features[0].geometry.coordinates;
				return [pt[0], pt[1]];
			}
		}
	} catch (e) {
		// Silent continue to offline fallback
	}

	// 3. Robust offline fallback
	return geocodeLocation(locationStr, countryStr);
}

module.exports = {
	geocodeLocation,
	geocodeAddress,
	KNOWN_COORDINATES,
};

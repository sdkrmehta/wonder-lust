const SUPPORTED_COUNTRIES = [
	"India",
	"Australia",
	"Brazil",
	"Canada",
	"France",
	"Germany",
	"Indonesia",
	"Italy",
	"Japan",
	"Malaysia",
	"Mexico",
	"Netherlands",
	"New Zealand",
	"Singapore",
	"South Africa",
	"South Korea",
	"Spain",
	"Switzerland",
	"Thailand",
	"United Arab Emirates",
	"United Kingdom",
	"United States",
];

const COUNTRY_POSTAL_RULES = {
	india: {
		pattern: /^[1-9]\d{5}$/,
		message: "PIN code for India must be a valid 6-digit PIN code (e.g. 400001)",
	},
	"united states": {
		pattern: /^\d{5}(?:-\d{4})?$/,
		message: "Postal/ZIP code for United States must be 5 digits or ZIP+4 (e.g. 10001)",
	},
	usa: {
		pattern: /^\d{5}(?:-\d{4})?$/,
		message: "Postal/ZIP code for United States must be 5 digits or ZIP+4 (e.g. 10001)",
	},
	us: {
		pattern: /^\d{5}(?:-\d{4})?$/,
		message: "Postal/ZIP code for United States must be 5 digits or ZIP+4 (e.g. 10001)",
	},
	"united kingdom": {
		pattern: /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i,
		message: "Postal code for United Kingdom must be a valid postcode (e.g. SW1A 1AA)",
	},
	uk: {
		pattern: /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i,
		message: "Postal code for United Kingdom must be a valid postcode (e.g. SW1A 1AA)",
	},
	canada: {
		pattern: /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/,
		message: "Postal code for Canada must follow A1A 1A1 format",
	},
	australia: {
		pattern: /^\d{4}$/,
		message: "Postcode for Australia must be 4 numeric digits",
	},
	singapore: {
		pattern: /^\d{6}$/,
		message: "Postal code for Singapore must be 6 numeric digits",
	},
	japan: {
		pattern: /^\d{3}-?\d{4}$/,
		message: "Postal code for Japan must follow 100-0001 format",
	},
	netherlands: {
		pattern: /^\d{4}\s?[A-Za-z]{2}$/,
		message: "Postal code for Netherlands must follow 1012 AB format",
	},
};

const GENERAL_POSTAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9\s-]{1,10}[A-Za-z0-9]$/;

function normalizeEmail(email) {
	return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function validatePostalCodeForCountry(postalCode, country = "India") {
	const cleanPostal = typeof postalCode === "string" ? postalCode.trim() : "";
	const cleanCountry = typeof country === "string" && country.trim() ? country.trim() : "India";
	if (!cleanPostal) {
		return { valid: false, message: "PIN / Postal code is required" };
	}

	const rule = COUNTRY_POSTAL_RULES[cleanCountry.toLowerCase()];
	if (rule) {
		if (!rule.pattern.test(cleanPostal)) {
			return { valid: false, message: rule.message };
		}
		return { valid: true, value: cleanPostal };
	}

	if (!GENERAL_POSTAL_PATTERN.test(cleanPostal)) {
		return {
			valid: false,
			message: "Please enter a valid postal code (3-12 letters, numbers, spaces, or hyphens)",
		};
	}

	return { valid: true, value: cleanPostal };
}

function formatAddressSummary({ addressLine1 = "", addressLine2 = "", landmark = "" } = {}) {
	return [addressLine1, addressLine2, landmark]
		.map((s) => (typeof s === "string" ? s.trim() : ""))
		.filter(Boolean)
		.join(", ");
}

function extractAddressSnapshot(source = {}) {
	const addressLine1 = String(source.addressLine1 || source.address || "").trim();
	const addressLine2 = String(source.addressLine2 || "").trim();
	const landmark = String(source.landmark || "").trim();
	const city = String(source.city || "").trim();
	const state = String(source.state || "").trim();
	const postalCode = String(source.postalCode || "").trim();
	const country = String(source.country || "India").trim() || "India";
	const address = formatAddressSummary({ addressLine1, addressLine2, landmark }) || String(source.address || "").trim();

	return {
		addressLine1,
		addressLine2,
		landmark,
		address,
		city,
		state,
		postalCode,
		country,
	};
}

module.exports = {
	SUPPORTED_COUNTRIES,
	validatePostalCodeForCountry,
	normalizeEmail,
	formatAddressSummary,
	extractAddressSnapshot,
};

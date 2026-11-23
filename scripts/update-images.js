const mongoose = require("mongoose");
const env = require("../config/env");
const Listing = require("../models/listing");

const PHOTO_POOLS = {
	Apartment: [
		"https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1493809842364-78817add7ffb?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1512918728675-ed5a9ecdebfd?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1501183638710-841dd1904471?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1484154218962-a197022b5858?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=80",
	],
	House: [
		"https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1576941089067-2de3c901e126?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1570129477492-45c003edd2be?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1598228723793-52759bba239c?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1518780664697-55e3ad937233?auto=format&fit=crop&w=800&q=80",
	],
	Cabin: [
		"https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1510798831971-661eb04b3739?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1502784444187-359ac186c5bb?auto=format&fit=crop&w=800&q=80",
	],
	Villa: [
		"https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=800&q=80",
	],
	Cottage: [
		"https://images.unsplash.com/photo-1552733407-5d5c46c3bb3b?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1583608205776-bfd35f0d9f83?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?auto=format&fit=crop&w=800&q=80",
	],
	Boats: [
		"https://images.unsplash.com/photo-1569263979104-865ab7cd8d17?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1544735716-392fe2489ffa?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?auto=format&fit=crop&w=800&q=80",
	],
	Hotel: [
		"https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=800&q=80",
		"https://images.unsplash.com/photo-1591088398332-8a7791972843?auto=format&fit=crop&w=800&q=80",
	],
};

async function updateListingImages() {
	console.log("Connecting to MongoDB to update listing images...");
	await mongoose.connect(env.DB_URL);

	const listings = await Listing.find({}).select("_id propertyType");
	console.log(`Found ${listings.length} listings to update with verified Unsplash photography...`);

	const BATCH_SIZE = 500;
	let ops = [];
	let totalUpdated = 0;

	for (let i = 0; i < listings.length; i++) {
		const l = listings[i];
		const propType = l.propertyType || "Apartment";
		const pool = PHOTO_POOLS[propType] || PHOTO_POOLS.Apartment;

		const primaryPic = pool[i % pool.length];
		const galleryImages = [
			{ url: primaryPic, isPrimary: true, filename: "primary" },
			{ url: pool[(i + 1) % pool.length], isPrimary: false, filename: "thumb_1" },
			{ url: pool[(i + 2) % pool.length], isPrimary: false, filename: "thumb_2" },
			{ url: pool[(i + 3) % pool.length], isPrimary: false, filename: "thumb_3" },
			{ url: pool[(i + 4) % pool.length], isPrimary: false, filename: "thumb_4" },
		];

		ops.push({
			updateOne: {
				filter: { _id: l._id },
				update: {
					$set: {
						image: {
							url: primaryPic,
							filename: "listing_cover",
						},
						images: galleryImages,
					},
				},
			},
		});

		if (ops.length >= BATCH_SIZE) {
			await Listing.bulkWrite(ops);
			totalUpdated += ops.length;
			process.stdout.write(`Updated ${totalUpdated} / ${listings.length} listings...\r`);
			ops = [];
		}
	}

	if (ops.length > 0) {
		await Listing.bulkWrite(ops);
		totalUpdated += ops.length;
	}

	console.log(`\nSuccessfully updated all ${totalUpdated} listings with high-resolution Unsplash photos!`);
	await mongoose.disconnect();
}

updateListingImages().catch((err) => {
	console.error("Image update error:", err);
	process.exit(1);
});

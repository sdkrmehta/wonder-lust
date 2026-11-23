const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const passportLocalMongoose = require("passport-local-mongoose");

const userSchema = new Schema(
	{
		email: {
			type: String,
			required: [true, "Email is required"],
			unique: true,
			lowercase: true,
			trim: true,
			match: [/^\S+@\S+\.\S+$/, "Please provide a valid email address"],
		},
		fullName: {
			type: String,
			trim: true,
			default: "",
		},
		avatar: {
			url: {
				type: String,
				default: "",
			},
			filename: {
				type: String,
				default: "",
			},
		},
		bio: {
			type: String,
			trim: true,
			default: "",
		},
		phone: {
			type: String,
			trim: true,
			default: "",
		},
		address: {
			type: String,
			trim: true,
			default: "",
		},
		city: {
			type: String,
			trim: true,
			default: "",
		},
		country: {
			type: String,
			trim: true,
			default: "India",
		},
		role: {
			type: String,
			enum: ["traveler", "host", "admin"],
			default: "traveler",
		},
		isSuperhost: {
			type: Boolean,
			default: false,
		},
	},
	{ timestamps: true },
);

// Directory and role lookup indexes
userSchema.index({ role: 1 });
userSchema.index({ isSuperhost: 1 });
userSchema.index({ createdAt: -1 });

userSchema.plugin(passportLocalMongoose);

module.exports = mongoose.model("User", userSchema);

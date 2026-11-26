const Redis = require("ioredis");
const { RedisStore } = require("rate-limit-redis");
const env = require("./env");
const RateLimitHit = require("../models/rateLimitHit");

let sharedRedisClient = null;
let redisHealthState = "disabled";

function getOrCreateRedisClient() {
	if (sharedRedisClient) {
		return sharedRedisClient;
	}
	if (!env.REDIS_URL) {
		return null;
	}

	const useTls = env.REDIS_URL.startsWith("rediss://");
	sharedRedisClient = new Redis(env.REDIS_URL, {
		maxRetriesPerRequest: 2,
		enableReadyCheck: true,
		connectTimeout: 5000,
		retryStrategy: (times) => Math.min(times * 200, 3000),
		...(useTls ? { tls: { rejectUnauthorized: true } } : {}),
	});

	redisHealthState = "connecting";
	sharedRedisClient.on("ready", () => {
		redisHealthState = "ready";
		console.log("[RATE-LIMIT] Connected to shared Redis store.");
	});
	sharedRedisClient.on("error", (err) => {
		redisHealthState = "error";
		console.error("[RATE-LIMIT] Redis client error:", err.message);
	});
	sharedRedisClient.on("close", () => {
		if (redisHealthState !== "closed") {
			redisHealthState = "disconnected";
		}
	});

	return sharedRedisClient;
}

class MongoRateLimitStore {
	constructor(options = {}) {
		this.prefix = options.prefix || "rl:";
		this.windowMs = options.windowMs || 15 * 60 * 1000;
		this.localKeys = false;
	}

	init(options) {
		if (options && typeof options.windowMs === "number") {
			this.windowMs = options.windowMs;
		}
	}

	_fullKey(key) {
		return `${this.prefix}${key}`;
	}

	async get(key) {
		const doc = await RateLimitHit.findOne({ key: this._fullKey(key) }).lean();
		if (!doc || !doc.resetTime || doc.resetTime <= new Date()) {
			return undefined;
		}
		return {
			totalHits: doc.totalHits,
			resetTime: new Date(doc.resetTime),
		};
	}

	async increment(key) {
		const fullKey = this._fullKey(key);
		const now = new Date();
		const nextReset = new Date(now.getTime() + this.windowMs);

		const doc = await RateLimitHit.findOneAndUpdate(
			{ key: fullKey },
			[
				{
					$set: {
						key: fullKey,
						_expired: {
							$or: [
								{ $eq: [{ $ifNull: ["$resetTime", null] }, null] },
								{ $lte: ["$resetTime", now] },
							],
						},
					},
				},
				{
					$set: {
						totalHits: {
							$cond: [
								"$_expired",
								1,
								{ $add: [{ $ifNull: ["$totalHits", 0] }, 1] },
							],
						},
						resetTime: {
							$cond: ["$_expired", nextReset, "$resetTime"],
						},
					},
				},
				{ $unset: "_expired" },
			],
			{ upsert: true, new: true },
		);

		return {
			totalHits: doc.totalHits,
			resetTime: new Date(doc.resetTime),
		};
	}

	async decrement(key) {
		const fullKey = this._fullKey(key);
		await RateLimitHit.updateOne(
			{ key: fullKey, totalHits: { $gt: 0 }, resetTime: { $gt: new Date() } },
			{ $inc: { totalHits: -1 } },
		);
	}

	async resetKey(key) {
		await RateLimitHit.deleteOne({ key: this._fullKey(key) });
	}
}

function createRateLimitStore(prefix = "rl:default:") {
	if (env.RATE_LIMIT_STORE === "redis") {
		const client = getOrCreateRedisClient();
		if (!client) {
			throw new Error("[RATE-LIMIT] REDIS_URL is required for Redis rate-limit store.");
		}
		return new RedisStore({
			sendCommand: (...args) => client.call(...args),
			prefix,
		});
	}

	if (env.RATE_LIMIT_STORE === "mongo") {
		return new MongoRateLimitStore({ prefix });
	}

	// Returning undefined causes express-rate-limit to use its built-in MemoryStore (dev/test only)
	return undefined;
}

function getRateLimitStoreInfo() {
	return {
		mode: env.RATE_LIMIT_STORE,
		redisStatus: env.RATE_LIMIT_STORE === "redis" ? redisHealthState : "not_configured",
	};
}

async function closeRateLimitStore() {
	if (!sharedRedisClient) return;
	const client = sharedRedisClient;
	sharedRedisClient = null;
	redisHealthState = "closed";
	try {
		await Promise.race([
			client.quit(),
			new Promise((resolve) => setTimeout(resolve, 1500)),
		]);
	} catch {
		try {
			client.disconnect();
		} catch {}
	}
}

module.exports = {
	MongoRateLimitStore,
	createRateLimitStore,
	getRateLimitStoreInfo,
	closeRateLimitStore,
};

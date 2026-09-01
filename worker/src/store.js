import { MongoClient } from "mongodb";

const DB_NAME = "pokemon_scraper";

// Uden en grænse venter driveren 30 sekunder på en database der ikke svarer.
// Kvitteringen til Discord er sendt længe før det, så brugeren ville stå med en
// "tænker"-boble der aldrig bliver til noget.
const MONGO_TIMEOUTS = { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 };

export async function withDb(env, fn) {
    const client = new MongoClient(env.MONGODB_URI, MONGO_TIMEOUTS);
    try {
        await client.connect();
        return await fn(client.db(DB_NAME));
    } finally {
        await client.close();
    }
}

export const products = db => db.collection("products");
export const watches = db => db.collection("watches");
export const shops = db => db.collection("shops");

export const productKey = (shop, productId) => `${shop}:${productId}`;

// Koden er det brugeren skriver i /unwatch. Den skal kunne læses højt fra en
// telefon, så O og 0 og I og 1 er udeladt.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newWatchCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    return [...bytes].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

// createIndex er idempotent, så det er enklere at sikre indeksene ved hvert
// snapshot end at holde styr på om de er lagt.
export async function ensureIndexes(db) {
    await Promise.all([
        products(db).createIndex({ shop: 1 }),
        products(db).createIndex({ firstSeen: -1 }),
        watches(db).createIndex({ shop: 1 }),
        watches(db).createIndex({ guildId: 1 }),
    ]);
}

import { MongoClient } from "mongodb";

const DB_NAME = "pokemon_scraper";

// Uden en grænse venter driveren 30 sekunder på en database der ikke svarer.
// Kvitteringen til Discord er sendt længe før det, så brugeren ville stå med en
// "tænker"-boble der aldrig bliver til noget. Det er serverSelectionTimeoutMS
// der holder den grænse.
//
// connectTimeoutMS må ikke være kort. Driveren sætter den som timer på socket'en
// under opkoblingen og slår den fra igen bagefter, men Workers' Node-lag slår
// den ikke fra: forbindelsen dør præcis så mange sekunder efter den blev åbnet,
// også midt i en skrivning. Så åbner driveren en ny, som dør på samme måde, og
// et stort snapshot bruger et minut og en snes forbindelser på det. Kelz0rs
// snapshot tager omkring 15 sekunder på én forbindelse, så et minut er rigeligt.
const MONGO_TIMEOUTS = { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 60000 };

// En Worker må højst have seks forbindelser åbne på én gang; den syvende står
// i kø. Driverens standardovervågning bruger to sockets pr. server, og Atlas
// har tre servere — så er de seks brugt inden den første forespørgsel, og
// forespørgslen står i kø indtil overvågningen udløber og rydder puljen. Med
// "poll" er det én socket pr. server, og én forbindelse til selve arbejdet
// er nok, for worker'en kører sine forespørgsler én ad gangen.
const MONGO_CONNECTIONS = { serverMonitoringMode: "poll", maxPoolSize: 1 };

export async function withDb(env, fn) {
    const client = new MongoClient(env.MONGODB_URI, { ...MONGO_TIMEOUTS, ...MONGO_CONNECTIONS });

    // Hver ny forbindelse tæller som et subrequest hos Cloudflare, og der er
    // et loft pr. kørsel. Tallet i loggen viser hvor tæt vi er på det.
    const opened = { pool: 0, closed: {}, errors: new Set(), timeline: [] };
    const started = Date.now();
    const host = address => String(address ?? "").replace(/\.4rynm\.mongodb\.net:27017$/, "");
    const note = text => opened.timeline.push(`${Date.now() - started}ms ${text}`);
    client.on("connectionCreated", event => {
        opened.pool++;
        note(`pool+ ${host(event.address)}`);
    });
    client.on("connectionClosed", event => {
        opened.closed[event.reason] = (opened.closed[event.reason] ?? 0) + 1;
        note(`pool- ${host(event.address)} ${event.reason}`);
        if (event.error) opened.errors.add(`${event.error.name}: ${event.error.message}`);
    });
    client.on("serverHeartbeatStarted", event => note(`puls> ${host(event.connectionId)}`));
    client.on("serverHeartbeatSucceeded", event => note(`puls< ${host(event.connectionId)} ${event.duration}ms`));
    client.on("serverHeartbeatFailed", event => note(`puls! ${host(event.connectionId)} ${event.duration}ms ${event.failure?.message}`));

    try {
        await client.connect();
        return await fn(client.db(DB_NAME));
    } finally {
        await client.close();
        console.log(`Mongo: ${opened.pool} forbindelser åbnet, lukket: ${JSON.stringify(opened.closed)}`);
        for (const error of opened.errors) console.log(`Mongo-forbindelse lukket med: ${error}`);
        if (opened.pool > 1) console.log(`Mongo-forløb: ${opened.timeline.slice(0, 60).join(" | ")}`);
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

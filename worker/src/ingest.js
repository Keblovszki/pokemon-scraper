import { products, watches, shops, productKey, ensureIndexes } from "./store.js";
import { postAlerts, postMessage } from "./notify.js";
import { dropPercent } from "./format.js";

// Et snapshot hvor næsten alt ser nyt ud betyder i praksis at butikken har
// ændret sine varenumre eller sin HTML — ikke at de har fået 145 varer ind på
// én gang. Vi gemmer dem, men holder alarmerne tilbage.
const FLOOD_LIMIT = 30;

// Kelz0r leverer knap 4000 varer, og skrives de i én bulkWrite, bliver
// worker'en slået ihjel med "exceeded CPU time limit". Prisen for at pakke
// skrivningerne vokser hurtigere end antallet, så de sendes i bidder.
const WRITE_BATCH = 250;

// Kelz0r bytter af og til to varer med samme navn rundt mellem to sider, og så
// mangler den ene i et ellers komplet snapshot. Blev den slettet med det samme,
// kom den tilbage som "ny vare" i næste runde. En vare skal derfor have været
// væk i flere snapshots i træk, før den regnes for fjernet.
const PRUNE_GRACE_MS = 3 * 60 * 60 * 1000;

const DEFAULT_MIN_DROP_PCT = 5;

export async function ingestSnapshot(env, db, snapshot) {
    const { shop, shopName, scrapedAt, complete, products: incoming } = snapshot;
    const now = new Date(scrapedAt ?? Date.now());

    await ensureIndexes(db);

    const shopDoc = await shops(db).findOne({ _id: shop });
    const known = new Map(
        (await products(db).find({ shop }).project({ price: 1, inStock: 1 }).toArray())
            .map(doc => [doc._id, doc])
    );

    const events = [];
    const writes = [];

    for (const item of incoming) {
        const key = productKey(shop, item.productId);
        const previous = known.get(key);
        const product = { ...item, shop, shopName };

        if (!previous) {
            events.push({ type: "new", product });
        } else {
            if (!previous.inStock && item.inStock) {
                events.push({ type: "restock", product, previous });
            }
            if (previous.price != null && item.price != null && item.price < previous.price) {
                events.push({ type: "price_drop", product, previous });
            }
        }

        writes.push({
            updateOne: {
                filter: { _id: key },
                update: {
                    $set: {
                        shop,
                        productId: item.productId,
                        name: item.name,
                        url: item.url,
                        image: item.image ?? null,
                        price: item.price ?? null,
                        normalPrice: item.normalPrice ?? null,
                        inStock: item.inStock,
                        stockText: item.stockText ?? null,
                        lastSeen: now,
                    },
                    $setOnInsert: { firstSeen: now },
                    ...(item.price != null ? { $min: { lowestPrice: item.price } } : {}),
                },
                upsert: true,
            },
        });
    }

    for (const batch of chunk(writes, WRITE_BATCH)) {
        await products(db).bulkWrite(batch, { ordered: false });
    }

    const newCount = events.filter(e => e.type === "new").length;
    const flooded = Boolean(shopDoc?.seeded) && newCount > FLOOD_LIMIT;

    // Varer der ikke er med i et komplet snapshot er væk fra butikken — eller
    // sorteret fra af adapteren — og skal også være væk hos os. Ellers bliver
    // /search, /latest og tællingerne i /shops ved med at vise varer botten
    // ikke længere følger.
    //
    // Alt vi lige har skrevet har fået `lastSeen` sat til snapshottets
    // tidspunkt, så det der står tilbage med en ældre tid er det der manglede.
    let removed = 0;
    if (canPrune({ complete, incomingCount: incoming.length, flooded })) {
        const { deletedCount } = await products(db).deleteMany({ shop, lastSeen: { $lt: pruneBefore(now) } });
        removed = deletedCount;
    }

    await shops(db).updateOne(
        { _id: shop },
        {
            $set: {
                name: shopName,
                lastScrapeAt: now,
                lastCount: incoming.length,
                lastComplete: complete !== false,
                seeded: true,
            },
        },
        { upsert: true }
    );

    if (!shopDoc?.seeded) {
        await postMessage(env, env.ADMIN_CHANNEL_ID, {
            content: `✅ **${shopName}** er nu i databasen med ${incoming.length} varer. Alarmer starter ved næste snapshot — brug \`/watch\` for at vælge hvad du vil have besked om.`,
        });
        return { seeded: incoming.length, removed, alerts: 0 };
    }

    if (flooded) {
        await postMessage(env, env.ADMIN_CHANNEL_ID, {
            content: `⚠️ **${shopName}** leverede ${newCount} ukendte varer i ét snapshot. Varenumrene er formentlig ændret, så alarmerne er holdt tilbage. Tjek adapteren i \`scraper/src/shops/\`.`,
        });
        return { saved: incoming.length, suppressed: events.length, alerts: 0 };
    }

    const alerts = await deliverEvents(env, db, shop, events);
    return { saved: incoming.length, events: events.length, removed, alerts };
}

// Oprydningen sletter alt vi ikke lige har set, så den skal kun løbe når
// snapshottet kan bære det: et delvist snapshot mangler pr. definition varer,
// et tomt snapshot er en adapter der er knækket, og et snapshot med nye
// varenumre ville tage hele butikken med sig.
export function canPrune({ complete, incomingCount, flooded }) {
    return complete !== false && incomingCount > 0 && !flooded;
}

// Varer med et `lastSeen` før dette tidspunkt har manglet i alle snapshots
// inden for fristen og må slettes.
export function pruneBefore(now) {
    return new Date(now.getTime() - PRUNE_GRACE_MS);
}

export function chunk(items, size) {
    const batches = [];
    for (let start = 0; start < items.length; start += size) {
        batches.push(items.slice(start, start + size));
    }
    return batches;
}

async function deliverEvents(env, db, shop, events) {
    if (!events.length) return 0;

    const active = await watches(db).find({ shop: { $in: [shop, "*"] } }).toArray();
    if (!active.length) return 0;

    // Flere /watch i samme kanal må ikke give samme alarm to gange, så
    // hændelserne samles i et sæt pr. kanal før de sendes.
    const byChannel = new Map();
    for (const watch of active) {
        for (const event of events) {
            if (!matchesWatch(watch, event)) continue;
            if (!byChannel.has(watch.channelId)) byChannel.set(watch.channelId, new Map());
            byChannel.get(watch.channelId).set(`${event.type}:${event.product.productId}`, event);
        }
    }

    let sent = 0;
    for (const [channelId, unique] of byChannel) {
        const channelEvents = [...unique.values()];
        await postAlerts(env, channelId, channelEvents);
        sent += channelEvents.length;
    }
    return sent;
}

export function matchesWatch(watch, event) {
    if (!watch.events.includes(event.type)) return false;

    const { product } = event;
    if (watch.maxPrice != null && (product.price == null || product.price > watch.maxPrice)) return false;

    if (event.type === "price_drop") {
        const pct = dropPercent(event.previous.price, product.price);
        if (pct < (watch.minDropPct ?? DEFAULT_MIN_DROP_PCT)) return false;
    }

    if (watch.keywords?.length) {
        const haystack = product.name.toLowerCase();
        if (!watch.keywords.every(word => haystack.includes(word))) return false;
    }
    return true;
}

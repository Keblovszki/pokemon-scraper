import { products, watches, shops, newWatchCode } from "./store.js";
import { formatPrice, formatRelative, truncate } from "./format.js";
import { SHOPS } from "./shops-list.js";

const EVENT_PRESETS = {
    alle: ["new", "restock", "price_drop"],
    new: ["new"],
    restock: ["restock"],
    price_drop: ["price_drop"],
    new_restock: ["new", "restock"],
};

const EVENT_LABELS = { new: "nye varer", restock: "restock", price_drop: "prisfald" };

const opt = (options, name) => options?.find(o => o.name === name)?.value;

// Alarmer sendes med bot-token til kanalen, og det kræver rettigheder — i
// modsætning til svaret på selve kommandoen, som interaction-tokenet dækker.
// Uden dette tjek ville /watch kvittere glad, og alarmerne fejle i tavshed
// bagefter, hvor ingen ser det.
const REQUIRED_PERMISSIONS = {
    "Vis kanal": 1n << 10n,
    "Send beskeder": 1n << 11n,
    "Indlejr links": 1n << 14n,
};

const ADMINISTRATOR = 1n << 3n;

export function missingPermissions(appPermissions) {
    const granted = BigInt(appPermissions ?? "0");
    if ((granted & ADMINISTRATOR) === ADMINISTRATOR) return [];

    return Object.entries(REQUIRED_PERMISSIONS)
        .filter(([, bit]) => (granted & bit) !== bit)
        .map(([name]) => name);
}

// Søgeordet går ind i et Mongo-regex, så alt der kan læses som mønster skal
// neutraliseres først.
const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function runCommand(interaction, env, db) {
    const { name, options } = interaction.data;

    switch (name) {
        case "watch": return addWatch(interaction, options, db);
        case "unwatch": return removeWatch(interaction, options, db);
        case "watches": return listWatches(interaction, db);
        case "shops": return shopStatus(env, db);
        case "latest": return latestProducts(options, db);
        case "search": return searchProducts(options, db);
        case "help": return help();
        default:
            console.error(`Ukendt kommando: ${name}`);
            return { content: "❌ Den kommando kender jeg ikke." };
    }
}

async function addWatch(interaction, options, db) {
    const keyword = opt(options, "keyword")?.trim();
    const shop = opt(options, "shop") ?? "*";
    const events = EVENT_PRESETS[opt(options, "events") ?? "alle"];
    const maxPrice = opt(options, "max_price") ?? null;
    const minDropPct = opt(options, "min_drop") ?? null;

    const watch = {
        code: newWatchCode(),
        guildId: interaction.guild_id,
        channelId: interaction.channel_id,
        shop,
        keywords: keyword ? keyword.toLowerCase().split(/\s+/).filter(Boolean) : [],
        keywordLabel: keyword ?? null,
        events,
        maxPrice,
        minDropPct,
        createdBy: interaction.member?.user?.id,
        createdAt: new Date(),
    };
    await watches(db).insertOne(watch);

    const scope = keyword ? `**${keyword}**` : "**alle varer**";
    const where = shop === "*" ? "alle butikker" : shopName(shop);
    const filters = [
        maxPrice != null ? `højst ${formatPrice(maxPrice)}` : null,
        minDropPct != null ? `prisfald fra ${minDropPct}%` : null,
    ].filter(Boolean);

    const missing = missingPermissions(interaction.app_permissions);

    return {
        content: [
            `🔔 Overvåger ${scope} hos ${where} i denne kanal.`,
            `Melder om: ${events.map(e => EVENT_LABELS[e]).join(", ")}.`,
            filters.length ? `Filtre: ${filters.join(" · ")}.` : null,
            `Kode \`${watch.code}\` — brug den i \`/unwatch\` for at stoppe igen.`,
            missing.length
                ? `\n⚠️ Men jeg mangler **${missing.join("**, **")}** i denne kanal, så alarmerne kan ikke sendes. Giv mig rettighederne, så virker overvågningen med det samme — den er gemt.`
                : null,
        ].filter(Boolean).join("\n"),
    };
}

async function removeWatch(interaction, options, db) {
    const code = String(opt(options, "kode")).trim().toUpperCase();
    const { deletedCount } = await watches(db).deleteOne({ guildId: interaction.guild_id, code });

    return {
        content: deletedCount
            ? `🔕 Overvågning \`${code}\` er stoppet.`
            : `❌ Fandt ingen overvågning med koden \`${code}\`. Kør \`/watches\` for at se dine.`,
    };
}

async function listWatches(interaction, db) {
    const active = await watches(db).find({ guildId: interaction.guild_id }).sort({ createdAt: 1 }).toArray();
    if (!active.length) {
        return { content: "Ingen overvågninger endnu. Start med `/watch`." };
    }

    const lines = active.map(w => {
        const scope = w.keywordLabel ? `"${w.keywordLabel}"` : "alle varer";
        const where = w.shop === "*" ? "alle butikker" : shopName(w.shop);
        const extras = [
            w.maxPrice != null ? `≤ ${formatPrice(w.maxPrice)}` : null,
            w.minDropPct != null ? `≥ ${w.minDropPct}% fald` : null,
        ].filter(Boolean);

        return [
            `\`${w.code}\` · ${scope} · ${where} · <#${w.channelId}>`,
            `└ ${w.events.map(e => EVENT_LABELS[e]).join(", ")}${extras.length ? ` · ${extras.join(" · ")}` : ""}`,
        ].join("\n");
    });

    return { embeds: [{ title: "Aktive overvågninger", description: lines.join("\n"), color: 0x5865f2 }] };
}

async function shopStatus(env, db) {
    const registered = await shops(db).find({}).toArray();
    if (!registered.length) {
        return { content: "Ingen butikker har sendt et snapshot endnu. Kører scraper-agenten?" };
    }

    const staleAfter = Number(env.STALE_MINUTES ?? 45) * 60000;
    const lines = await Promise.all(registered.map(async shop => {
        const stored = await products(db).countDocuments({ shop: shop._id });
        const inStock = await products(db).countDocuments({ shop: shop._id, inStock: true });
        const age = Date.now() - new Date(shop.lastScrapeAt).getTime();
        const health = age > staleAfter ? "🔴" : shop.lastComplete === false ? "🟡" : "🟢";

        return [
            `${health} **${shop.name}** — ${formatRelative(shop.lastScrapeAt)}`,
            `└ ${stored} varer kendt, ${inStock} på lager, ${shop.lastCount} i sidste snapshot`,
        ].join("\n");
    }));

    return { embeds: [{ title: "Butikker", description: lines.join("\n"), color: 0x5865f2 }] };
}

async function latestProducts(options, db) {
    const shop = opt(options, "shop");
    const limit = opt(options, "antal") ?? 5;

    const found = await products(db)
        .find(shop ? { shop } : {})
        .sort({ firstSeen: -1 })
        .limit(limit)
        .toArray();

    if (!found.length) return { content: "Ingen varer i databasen endnu." };

    return {
        embeds: [{
            title: "Senest opdagede varer",
            description: found.map(productLine).join("\n"),
            color: 0x2ecc71,
        }],
    };
}

async function searchProducts(options, db) {
    const keyword = String(opt(options, "keyword")).trim();
    const onlyInStock = opt(options, "kun_paa_lager") ?? false;

    // Hvert ord skal findes i navnet, men rækkefølgen er fri, så
    // "super premium collection" også rammer "Premium Super Collection".
    const words = keyword.split(/\s+/).filter(Boolean);
    if (!words.length) return { content: "Skriv mindst ét ord at søge efter." };
    const filter = { $and: words.map(word => ({ name: { $regex: escapeRegex(word), $options: "i" } })) };
    if (onlyInStock) filter.inStock = true;

    const found = await products(db).find(filter).sort({ price: 1 }).limit(10).toArray();
    if (!found.length) {
        return { content: `Fandt intet der matcher **${keyword}**${onlyInStock ? " på lager" : ""}.` };
    }

    return {
        embeds: [{
            title: `Søgning: ${truncate(keyword, 200)}`,
            description: found.map(productLine).join("\n"),
            color: 0x5865f2,
        }],
    };
}

const productLine = p =>
    `${p.inStock ? "🟢" : "⚪"} [${truncate(p.name, 90)}](${p.url}) — ${formatPrice(p.price)}`;

const shopName = id => SHOPS.find(s => s.id === id)?.name ?? id;

const help = () => ({
    embeds: [{
        title: "Pokémon-vagten",
        description: [
            "Jeg holder øje med webshops og melder når der sker noget med Pokémon-varer.",
            "",
            "**`/watch`** — overvåg i denne kanal. Sæt `keyword` for at indsnævre (fx `elite trainer box`), ellers får du alt.",
            "**`/watches`** — se og få koderne på det der overvåges.",
            "**`/unwatch`** — stop en overvågning ud fra dens kode.",
            "**`/shops`** — hvornår hver butik sidst blev tjekket, og om scraperen er sund.",
            "**`/latest`** — de senest opdagede varer.",
            "**`/search`** — søg i det jeg allerede har set.",
            "",
            "Jeg melder tre ting: **nye varer**, **restock** (fra ikke-på-lager til på-lager) og **prisfald**.",
        ].join("\n"),
        color: 0xffcb05,
    }],
});

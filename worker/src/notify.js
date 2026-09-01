import { formatPrice, formatRelative, dropPercent, truncate } from "./format.js";

const EVENT_STYLE = {
    new: { color: 0x2ecc71, label: "Ny vare" },
    restock: { color: 0x3498db, label: "På lager igen" },
    price_drop: { color: 0xe67e22, label: "Prisfald" },
};

// Discord tager højst 10 embeds pr. besked.
const EMBEDS_PER_MESSAGE = 10;

// Et loft pr. kanal pr. snapshot. Rammer vi det, er der noget galt med en
// selector eller et alt for bredt /watch, og 200 beskeder gør hverken brugeren
// eller vores rate limit gladere end én opsummering.
const MAX_ALERTS_PER_CHANNEL = 25;

export function buildEmbed(event) {
    const { type, product, previous } = event;
    const style = EVENT_STYLE[type];

    const fields = [{ name: "Pris", value: formatPrice(product.price), inline: true }];

    if (type === "price_drop") {
        fields.push({
            name: "Før",
            value: `${formatPrice(previous.price)} (-${dropPercent(previous.price, product.price)}%)`,
            inline: true,
        });
    } else if (product.normalPrice != null && product.normalPrice > product.price) {
        fields.push({ name: "Normalpris", value: formatPrice(product.normalPrice), inline: true });
    }

    fields.push({
        name: "Lager",
        value: product.stockText || (product.inStock ? "På lager" : "Ikke på lager"),
        inline: true,
    });

    return {
        title: truncate(product.name, 256),
        url: product.url,
        color: style.color,
        author: { name: `${style.label} · ${product.shopName}` },
        fields,
        ...(product.image ? { thumbnail: { url: product.image } } : {}),
        footer: { text: `Varenr. ${product.productId}` },
        timestamp: new Date().toISOString(),
    };
}

export async function postAlerts(env, channelId, events) {
    const shown = events.slice(0, MAX_ALERTS_PER_CHANNEL);
    const embeds = shown.map(buildEmbed);

    for (let i = 0; i < embeds.length; i += EMBEDS_PER_MESSAGE) {
        await postMessage(env, channelId, { embeds: embeds.slice(i, i + EMBEDS_PER_MESSAGE) });
    }

    if (events.length > shown.length) {
        await postMessage(env, channelId, {
            content: `… og ${events.length - shown.length} flere hændelser blev udeladt. Brug \`/watches\` og indsnævr din overvågning.`,
        });
    }
}

export async function postMessage(env, channelId, payload) {
    if (!channelId) return;

    for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
            method: "POST",
            headers: {
                Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        if (res.ok) return;

        // Discord fortæller selv hvor længe der er lukket. Kun 429 er værd at
        // prøve igen på; en 403 bliver ikke bedre af at blive gentaget.
        if (res.status === 429) {
            const { retry_after: retryAfter = 1 } = await res.json().catch(() => ({}));
            await new Promise(r => setTimeout(r, retryAfter * 1000));
            continue;
        }

        console.error(`Kunne ikke poste i ${channelId} (${res.status}): ${await res.text()}`);
        return;
    }
    console.error(`Gav op på ${channelId} efter gentagne rate limits`);
}

export const staleWarning = (shopName, lastSeen) =>
    `⚠️ **${shopName}** har ikke sendt et snapshot siden ${formatRelative(lastSeen)}. Kører scraper-agenten?`;

import { openBrowser, wait } from "./browser.js";
import { SHOPS, findShop } from "./shops/index.js";
import { pushSnapshot } from "./push.js";

const args = new Set(process.argv.slice(2));
const once = args.has("--once");
const dryRun = args.has("--dry-run");
const visible = args.has("--visible");
const onlyShop = [...args].find(a => a.startsWith("--shop="))?.split("=")[1];

const config = {
    workerUrl: (process.env.WORKER_URL ?? "").replace(/\/$/, ""),
    ingestSecret: process.env.INGEST_SECRET ?? "",
    intervalMinutes: Number(process.env.INTERVAL_MINUTES ?? 10),
    profileDir: process.env.PROFILE_DIR ?? "./.browser-profile",
};

if (!dryRun && (!config.workerUrl || !config.ingestSecret)) {
    console.error("❌ Mangler WORKER_URL og/eller INGEST_SECRET. Se .env.example.");
    process.exit(1);
}

const targets = onlyShop ? [findShop(onlyShop)].filter(Boolean) : SHOPS;
if (!targets.length) {
    console.error(`❌ Kender ingen butik med id "${onlyShop}". Kendte: ${SHOPS.map(s => s.id).join(", ")}`);
    process.exit(1);
}

const log = (...parts) => console.log(`[${new Date().toISOString()}]`, ...parts);

let browser = null;

async function browserPage() {
    if (!browser) {
        browser = await openBrowser({ profileDir: config.profileDir, visible });
        log("Browser åbnet");
    }
    return browser.page;
}

async function closeBrowser() {
    if (!browser) return;
    await browser.context.close().catch(() => {});
    browser = null;
}

async function runCycle() {
    for (const shop of targets) {
        const started = Date.now();
        try {
            const page = await browserPage();
            const result = await shop.scrape(page, message => log(`${shop.id}:`, message));
            const seconds = Math.round((Date.now() - started) / 1000);
            log(`${shop.id}: ${result.products.length} varer på ${seconds}s (komplet: ${result.complete})`);

            if (dryRun) {
                summarize(result.products);
                continue;
            }
            if (!result.products.length) {
                log(`${shop.id}: intet at sende — scrapen fandt ingen varer`);
                continue;
            }
            await pushSnapshot(config, shop, result, message => log(`${shop.id}:`, message));
        } catch (error) {
            log(`${shop.id}: FEJL — ${error.message}`);
            // Browseren kan være havnet i en tilstand hvor intet virker, fx efter
            // et nedbrud eller en udfordring der ikke gik igennem. Næste runde
            // starter med et rent vindue.
            await closeBrowser();
        }
    }
}

function summarize(products) {
    const inStock = products.filter(p => p.inStock).length;
    const missingPrice = products.filter(p => p.price == null).length;
    log(`Tørkørsel: ${inStock} på lager, ${products.length - inStock} bestillingsvarer, ${missingPrice} uden pris`);

    for (const product of products.slice(0, 5)) {
        log(`  ${product.inStock ? "🟢" : "⚪"} ${product.productId} ${product.price} kr. — ${product.name}`);
    }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
        log(`${signal} modtaget, lukker ned`);
        await closeBrowser();
        process.exit(0);
    });
}

log(`Starter: ${targets.map(s => s.id).join(", ")}${dryRun ? " (tørkørsel)" : ""}`);

while (true) {
    await runCycle();
    if (once) break;

    // Lidt slør på intervallet, så vi ikke rammer butikken på samme sekund
    // hver gang.
    const jitter = Math.random() * 60000;
    const nextRun = config.intervalMinutes * 60000 + jitter;
    log(`Næste runde om ${Math.round(nextRun / 60000)} min.`);
    await wait(nextRun);
}

await closeBrowser();
log("Færdig");

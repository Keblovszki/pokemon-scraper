import { loadPage, wait } from "../browser.js";

const BASE = "https://www.proshop.dk";

// Proshop viser 25 varer ad gangen som standard, men accepterer ?ps=100. Det
// gør Pokemon-kategoriens ~145 varer til to sidevisninger frem for seks.
const PAGE_SIZE = 100;

// Sikkerhedsnet hvis produkttallet eller pagineringen holder op med at give
// mening, så løkken ikke bliver ved med at hente sider.
const MAX_PAGES = 20;

// Pause mellem sidevisninger. Vi henter nogle få sider hvert tiende minut, og
// der er ingen grund til at gøre det hurtigere end et menneske ville.
const DELAY_MS = 2000;

export const shop = {
    id: "proshop",
    name: "Proshop",
    needsBrowser: true,
    // Hovedkategorien "/Pokemon" er 147 varer, men de 127 er bamser, figurer og
    // legetøj. Butikkens egen kortkategori rammer kortspillet præcist, inklusive
    // portfolios og lommer til kortene.
    categories: [{ label: "Pokemon-kort", path: "/pokemon-kort" }],

    async scrape(page, log) {
        const all = new Map();
        let complete = true;

        for (const category of this.categories) {
            const { products, reachedEnd } = await scrapeCategory(page, category, log);
            for (const product of products) all.set(product.productId, product);
            if (!reachedEnd) complete = false;
        }

        return { products: [...all.values()], complete };
    },
};

async function scrapeCategory(page, category, log) {
    const products = [];
    let expected = null;

    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
        const url = `${BASE}${category.path}?ps=${PAGE_SIZE}&pn=${pageNumber}`;
        await loadPage(page, url);

        if (expected === null) {
            expected = await readProductCount(page);
            log(`${category.label}: ${expected ?? "ukendt antal"} varer ifølge Proshop`);
        }

        const batch = await extractProducts(page);
        products.push(...batch);
        log(`${category.label} side ${pageNumber}: ${batch.length} varer (i alt ${products.length})`);

        if (!batch.length) break;
        if (expected != null && products.length >= expected) {
            return { products, reachedEnd: true };
        }
        if (batch.length < PAGE_SIZE) return { products, reachedEnd: true };

        await wait(DELAY_MS);
    }

    // Vi nåede MAX_PAGES uden at finde slutningen. Varerne er stadig gode, men
    // snapshottet er ikke hele kategorien, og det skal worker'en have at vide.
    log(`${category.label}: stoppede ved sidegrænsen med ${products.length} varer`);
    return { products, reachedEnd: false };
}

async function readProductCount(page) {
    const text = await page.locator("#product-count").first().textContent().catch(() => null);
    const count = Number.parseInt(text?.replace(/\D/g, "") ?? "", 10);
    return Number.isFinite(count) ? count : null;
}

function extractProducts(page) {
    return page.$$eval("li.site-productlist-item", items =>
        items.flatMap(item => {
            const link = item.querySelector("a.site-product-link");
            const href = link?.getAttribute("href");
            if (!href) return [];

            // Varenummeret er sidste led i URL'en, fx /Pokemon/Scorbunny-Bamse/3196393.
            // Købsformularen har det samme nummer, men findes kun på varer der
            // kan lægges i kurven.
            const fromUrl = href.split("?")[0].split("/").filter(Boolean).pop();
            const productId = /^\d+$/.test(fromUrl ?? "")
                ? fromUrl
                : item.querySelector('input[name="productId"]')?.value;
            if (!productId) return [];

            const name = link.querySelector("h2")?.textContent?.trim();
            if (!name) return [];

            const parsePrice = selector => {
                const raw = item.querySelector(selector)?.textContent;
                if (!raw) return null;
                // "1.299,00 kr." -> 1299. Punktum er tusindtalsskiller på dansk.
                const value = Number.parseFloat(
                    raw.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".")
                );
                return Number.isFinite(value) ? value : null;
            };

            // Proshop bruger to lagerikoner: "-in" dækker både eget lager og
            // fjernlager og betyder at varen kan købes nu, mens "-comming"
            // er bestillingsvarer der endnu ikke er kommet ind.
            const stockClass = item.querySelector(".site-stock-icon")?.className ?? "";
            const image = item.querySelector("img")?.getAttribute("src");

            return [{
                productId,
                name: name.replace(/\s+/g, " "),
                url: new URL(href, location.origin).href,
                image: image ? new URL(image, location.origin).href : null,
                price: parsePrice("span.site-currency-lg"),
                normalPrice: parsePrice(".presales-price .site-currency-pre"),
                inStock: stockClass.includes("site-icon-stock-in"),
                stockText: item.querySelector(".site-stock-text")?.textContent?.trim() ?? null,
            }];
        })
    );
}

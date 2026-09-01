import { wait } from "../browser.js";

const BASE = "https://mtgwebshop.dk";

// Butikken kører på Shopify, og hele kataloget ligger frit som JSON. Det gør
// den her adapter fundamentalt mere holdbar end Proshops: ingen selectorer der
// kan knække ved et designskift, og ingen browser overhovedet.
const PAGE_SIZE = 250;

// Butikken har omkring 1600 varer, altså syv sider. Grænsen er et sikkerhedsnet
// hvis pagineringen holder op med at give mening.
const MAX_PAGES = 20;

const DELAY_MS = 1000;

// Der sælges også Magic, Lorcana, Funko og tilbehør. Pokémon-varerne kendes på
// deres "vendor", men akrylkasser og mapper ligger under producentens eget navn
// og røber sig kun i titlen.
const POKEMON = /pok[eé]mon/i;

// Endpointet er offentligt og vi henter syv sider hvert kvarter, så der er
// ingen grund til at forklæde os som en browser.
const USER_AGENT = "pokemon-scraper (+https://github.com/Keblovszki/pokemon-scraper)";

export const shop = {
    id: "mtgwebshop",
    name: "MTGwebshop",
    needsBrowser: false,

    async scrape(_page, log) {
        const products = [];
        let complete = false;

        for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
            const batch = await fetchPage(pageNumber);
            const relevant = batch.filter(isPokemon).map(toProduct);
            products.push(...relevant);
            log(`side ${pageNumber}: ${batch.length} varer, heraf ${relevant.length} Pokémon (i alt ${products.length})`);

            if (batch.length < PAGE_SIZE) {
                complete = true;
                break;
            }
            await wait(DELAY_MS);
        }

        // Vi nåede sidegrænsen uden at finde slutningen. Varerne er stadig gode,
        // men snapshottet er ikke hele butikken, og det skal worker'en vide.
        if (!complete) log(`stoppede ved sidegrænsen med ${products.length} varer`);

        return { products, complete };
    },
};

async function fetchPage(pageNumber) {
    const url = `${BASE}/products.json?limit=${PAGE_SIZE}&page=${pageNumber}`;
    const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });

    if (!response.ok) throw new Error(`${url} svarede ${response.status}`);

    const { products } = await response.json();
    return products ?? [];
}

const isPokemon = product => POKEMON.test(product.vendor ?? "") || POKEMON.test(product.title ?? "");

function toProduct(product) {
    const variants = product.variants ?? [];
    const purchasable = variants.filter(variant => variant.available);

    // Varer med flere varianter er typisk enkeltkort i forskellig stand. Prisen
    // skal være den man kan købe til lige nu, så vi tager den billigste variant
    // der er på lager og falder tilbage til den billigste overhovedet.
    const chosen = cheapest(purchasable.length ? purchasable : variants);

    return {
        productId: String(product.id),
        name: product.title.replace(/\s+/g, " ").trim(),
        url: `${BASE}/products/${product.handle}`,
        image: product.images?.[0]?.src ?? null,
        price: toNumber(chosen?.price),
        // Shopify kalder før-prisen "compare_at_price". Worker'en viser den kun
        // når den er højere end prisen, så et tomt felt gør ingen skade.
        normalPrice: toNumber(chosen?.compare_at_price),
        inStock: purchasable.length > 0,
        // Shopify har ingen lagertekst. Worker'en skriver selv "På lager" eller
        // "Ikke på lager" når feltet er tomt.
        stockText: null,
    };
}

function cheapest(variants) {
    let best = null;
    for (const variant of variants) {
        const price = toNumber(variant.price);
        if (price == null) continue;
        if (best === null || price < toNumber(best.price)) best = variant;
    }
    return best ?? variants[0] ?? null;
}

function toNumber(value) {
    if (value == null || value === "") return null;
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? number : null;
}

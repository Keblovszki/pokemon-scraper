import { wait } from "../browser.js";

const BASE = "https://www.mugglealley.dk";

// Butikken kører på Smartweb, hvor varelisten hentes af et AngularJS-frontend
// fra /json/products. Vi spørger samme endpoint direkte: ingen selectorer og
// ingen browser.
//
// `field=category` uden en rigtig kategori giver hele butikken i ét svar. Det
// er nemmere at filtrere selv end at holde styr på butikkens ~30
// Pokémon-underkategorier, og `amount` fortæller hvornår vi har det hele.
const LIST_URL = `${BASE}/json/products?field=category&currencyIso=DKK`;

const PAGE_SIZE = 250;

// Butikken har omkring 525 varer i alt. Grænsen er et sikkerhedsnet hvis
// pagineringen holder op med at give mening.
const MAX_PAGES = 20;

const DELAY_MS = 1000;

const USER_AGENT = "pokemon-scraper (+https://github.com/Keblovszki/pokemon-scraper)";

const POKEMON = /pok[eé]mon/i;

// Butikken sælger også Magic, One Piece, Lorcana og Weiss Schwarz. Varens
// kategori står i dens adresse, fx /shop/239-pokemon-kort/691-booster-box/.
const CATEGORY = /^\/shop\/([^/]+)/;

// Bamser og figurer er Pokémon, men ikke kortspillet. De har deres egne
// kategorier, og et par stykker er lagt i almindelige tilbehørskategorier og
// røber sig kun i titlen.
const NON_CARD = /bamser?|plush|figur/i;

export const shop = {
    id: "mugglealley",
    name: "Muggle Alley",
    needsBrowser: false,

    async scrape(_page, log) {
        const products = [];
        let complete = false;

        for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
            const { amount, batch } = await fetchPage(pageNumber);
            const relevant = batch.filter(isPokemon).map(toProduct);
            products.push(...relevant);
            log(`side ${pageNumber}: ${batch.length} varer, heraf ${relevant.length} Pokémon (i alt ${products.length})`);

            if (!batch.length || pageNumber * PAGE_SIZE >= amount) {
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
    const url = `${LIST_URL}&page=${pageNumber}&limit=${PAGE_SIZE}`;
    const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });

    if (!response.ok) throw new Error(`${url} svarede ${response.status}`);

    const { amount, products } = await response.json();
    return { amount: amount ?? 0, batch: products ?? [] };
}

function isPokemon(product) {
    const category = CATEGORY.exec(product.Handle ?? "")?.[1] ?? "";
    const title = product.Title ?? "";

    if (NON_CARD.test(category) || NON_CARD.test(title)) return false;

    return POKEMON.test(category) || POKEMON.test(title);
}

function toProduct(product) {
    // Priserne er en trappe med mængderabat. Den første er styksprisen, og det
    // er den kunden ser i listen.
    const price = product.Prices?.[0] ?? null;

    return {
        productId: String(product.Id),
        name: (product.Title ?? "").replace(/\s+/g, " ").trim(),
        url: `${BASE}${product.Handle}`,
        image: product.Images?.[0] ? `${BASE}${product.Images[0]}` : null,
        price: toNumber(price?.PriceMinWithVat),
        // Før-prisen findes altid. Worker'en viser den kun når den er højere
        // end prisen, så en vare uden rabat gør ingen skade.
        normalPrice: toNumber(price?.FullPriceMinWithVat),
        // Butikken lader udsolgte varer blive stående med pris og knap, så det
        // er `Buyable` der afgør om varen kan købes nu.
        inStock: product.Buyable === true,
        stockText: product.Buyable === true && product.Stock > 0 ? `${product.Stock} på lager` : null,
    };
}

function toNumber(value) {
    if (value == null || value === "") return null;
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? number : null;
}

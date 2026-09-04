import { wait } from "../browser.js";

const BASE = "https://www.kelz0r.dk/magic/";

// Butikken er en Zen Cart uden JSON-kilde, så her skal der læses HTML. Til
// gengæld mærker den hver vare op med schema.org-microdata — navn, adresse,
// billede, pris og lagerstatus står i itemprop-attributter, som er langt mere
// holdbare end butikkens CSS-klasser.
const ROOT_CATEGORY = "187";

// Alle Pokémon-varer ligger under kategori 187 og dens underkategorier.
// Underkategorierne læses af rodsiden i stedet for at stå her, så en ny
// kategori kommer med af sig selv.
const CATEGORY_LINK = /-c-(187(?:_[0-9]+)?)[.]html/g;

// Butikken viser 40 varer pr. side og lader sig ikke overtale til flere.
const PAGE_SIZE = 40;

// Der er omkring 3900 varer, altså knap hundrede sider. Grænsen pr. kategori
// er et sikkerhedsnet hvis pagineringen holder op med at give mening.
const MAX_PAGES = 60;

const DELAY_MS = 500;

const USER_AGENT = "pokemon-scraper (+https://github.com/Keblovszki/pokemon-scraper)";

// Hver vare er sit eget schema.org/Product. Vi klipper siden op på dem og
// læser felterne ud af hvert stykke for sig.
const PRODUCT_SPLIT = 'itemtype="http://schema.org/Product"';

const TOTAL = /numberOfItems"\s+content="(\d+)"/;
const URL_FIELD = /itemprop="url"\s+href="([^"]+)"/;
const PRODUCT_ID = /-p-(\d+)\.html/;
const NAME = /<span itemprop="name">([\s\S]*?)<\/span>/;
const IMAGE = /<img[^>]*\ssrc="([^"]+)"[^>]*itemprop="image"/;

// Prisen og lagerstatussen skal læses inden for varens eget pristilbud. Den
// sidste vare på siden slæber resten af sidens HTML med sig, og der står bl.a.
// en "Nyheder"-kasse med sin egen overstregede pris.
const OFFER = /itemprop="offers"[\s\S]*?<\/div>/;
const PRICE = /<meta itemprop="price" content="([\d.]+)"/;
const NORMAL_PRICE = /<del>([^<]*)<\/del>/;
const IN_STOCK = /itemprop="availability" href="http:\/\/schema\.org\/InStock"/;

// Varer butikken ikke sælger lige nu står til 999999 kr. Det er ikke en pris,
// og gemte vi den, ville varen udløse et gigantisk "prisfald" den dag den kom
// til salg igen.
const NOT_FOR_SALE = 999999;

// Butikken har lagt et par vejledninger ind mellem varerne. De har en pris og
// ser ud som alt andet, men de er ikke noget man vil have besked om.
const TYPE = /<div class="listType">([^<]*)<\/div>/;
const GUIDE = /^guide$/i;

export const shop = {
    id: "kelz0r",
    name: "Kelz0r",
    needsBrowser: false,

    async scrape(_page, log) {
        const categories = await fetchCategories();
        log(`${categories.length} kategorier`);

        // Den samme vare kan ligge i flere kategorier, og worker'en skal have
        // hver vare én gang.
        const seen = new Map();
        let complete = true;

        for (const category of categories) {
            const done = await scrapeCategory(category, seen, log);
            if (!done) complete = false;
        }

        return { products: [...seen.values()], complete };
    },
};

async function scrapeCategory(category, seen, log) {
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
        const html = await fetchPage(category, pageNumber);
        const total = Number(TOTAL.exec(html)?.[1] ?? 0);
        const rows = html.split(PRODUCT_SPLIT).slice(1);

        for (const row of rows) {
            const product = toProduct(row);
            if (product) seen.set(product.productId, product);
        }

        if (pageNumber === 1) log(`kategori ${category}: ${total} varer`);
        if (!rows.length || pageNumber * PAGE_SIZE >= total) return true;

        await wait(DELAY_MS);
    }

    log(`kategori ${category}: stoppede ved sidegrænsen`);
    return false;
}

async function fetchCategories() {
    const html = await get(`${BASE}x-c-${ROOT_CATEGORY}.html`);
    const found = [...html.matchAll(CATEGORY_LINK)].map(match => match[1]);

    // Rodkategorien har selv en håndfuld varer, og den står ikke i sin egen
    // liste over underkategorier.
    return [...new Set([ROOT_CATEGORY, ...found])];
}

function fetchPage(category, pageNumber) {
    // Slug'en i adressen er kun pynt; butikken slår op på tallet efter -c-.
    return get(`${BASE}x-c-${category}.html?sort=2a&page=${pageNumber}`);
}

async function get(url) {
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) throw new Error(`${url} svarede ${response.status}`);
    return response.text();
}

function toProduct(row) {
    const url = URL_FIELD.exec(row)?.[1];
    const productId = url && PRODUCT_ID.exec(url)?.[1];
    if (!productId) return null;

    if (GUIDE.test(decode(TYPE.exec(row)?.[1] ?? "").trim())) return null;

    const image = IMAGE.exec(row)?.[1];
    const offer = OFFER.exec(row)?.[0] ?? "";
    const price = toNumber(PRICE.exec(offer)?.[1]);

    return {
        productId,
        name: decode(NAME.exec(row)?.[1] ?? "").replace(/\s+/g, " ").trim(),
        // Adressen slæber en sessionsnøgle med sig, og den er ny hver gang.
        url: url.split("?")[0],
        image: image ? new URL(image, BASE).href : null,
        price: price === NOT_FOR_SALE ? null : price,
        normalPrice: toDanishNumber(NORMAL_PRICE.exec(offer)?.[1]),
        inStock: IN_STOCK.test(offer),
        // Butikken skriver ingen lagertekst i listen. Worker'en skriver selv
        // "På lager" eller "Ikke på lager" når feltet er tomt.
        stockText: null,
    };
}

function decode(text) {
    return text
        .replace(/<[^>]*>/g, "")
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&nbsp;/g, " ")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}

function toNumber(value) {
    if (value == null || value === "") return null;
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? number : null;
}

// Før-prisen står som den vises i butikken, fx "530,00 kr".
function toDanishNumber(value) {
    if (!value) return null;
    return toNumber(value.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, ""));
}

import { POKEMON, scrapeShopify } from "./shopify.js";

const BASE = "https://matraws.dk";

// Butikken har over 22.000 Pokémon-varer, og næsten alle er enkeltkort. Det er
// for mange til at hente hele kataloget, så vi tager samlingen "Alt Pokémon"
// i stedet: omkring 1.500 varer med alle de forseglede produkter og tilbehøret,
// men også nogle enkeltkort, gradede kort, figurer og bamser, som sorteres fra.
const COLLECTION = "alt-pokemon";

// Butikken mærker enkeltkort og gradede kort med deres egen varetype.
const SINGLE_CARD = /single|graded/i;

// Figurer, bamser og byggesæt er Pokémon, men ikke kortspillet. De kendes
// mest på varetypen og ellers på producenten.
const NON_CARD_TYPES = /figur|tøjdyr|plush|konstruktionssæt|lampe|plakat/i;
const NON_CARD_VENDORS = /funko|squishmallow|nanoblock|mega construx|lego|poképla/i;

// Godt hundrede varer har ingen varetype. Kortvarerne imellem dem har alle
// "TCG" i titlen eller hos producenten ("Pokémon TCG"); resten er sokker,
// sengetøj, bamser og T-shirts med producenten "Pokémon".
const TCG = /tcg/i;

export const shop = {
    id: "matraws",
    name: "Matraws",
    needsBrowser: false,

    scrape: (_page, log) => scrapeShopify({ base: BASE, collection: COLLECTION, keep: isSealedPokemon }, log),
};

function isSealedPokemon(product) {
    const type = product.product_type ?? "";
    const vendor = product.vendor ?? "";
    const title = product.title ?? "";

    if (SINGLE_CARD.test(type)) return false;
    if (NON_CARD_TYPES.test(type) || NON_CARD_VENDORS.test(vendor)) return false;
    if (!type && !TCG.test(vendor) && !TCG.test(title)) return false;

    // Samlingen er butikkens egen, men et par varer fra andre kortspil er
    // havnet i den, så Pokémon skal stå et sted på varen.
    return POKEMON.test(vendor) || POKEMON.test(title) || POKEMON.test(type);
}

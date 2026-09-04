import { POKEMON, scrapeShopify } from "./shopify.js";

const BASE = "https://mtgwebshop.dk";

// Der sælges også Magic, Lorcana og Yugioh. Pokémon-varerne kendes på deres
// "vendor", men lommer, mapper og akrylkasser til kortene ligger under
// producentens eget navn og røber sig kun i titlen.
//
// Producenter hvis Pokémon-varer ikke har med kortspillet at gøre. Listen er
// vendt om med vilje: alt andet tilbehør med Pokémon i titlen er til kortene og
// tæller med, så en ny mærkevare med lommer kommer af sig selv.
const NON_CARD_VENDORS = /funko|squishmallow/i;

// Et par varer er mærket som Pokémon af butikken, men er bamser.
const PLUSH = /bamse|plush/i;

export const shop = {
    id: "mtgwebshop",
    name: "MTGwebshop",
    needsBrowser: false,

    scrape: (_page, log) => scrapeShopify({ base: BASE, keep: isPokemon }, log),
};

function isPokemon(product) {
    const vendor = product.vendor ?? "";
    const title = product.title ?? "";

    if (PLUSH.test(title)) return false;
    if (POKEMON.test(vendor)) return true;
    if (!POKEMON.test(title)) return false;

    return !NON_CARD_VENDORS.test(vendor);
}

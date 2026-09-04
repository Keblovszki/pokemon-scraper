import { POKEMON, scrapeShopify } from "./shopify.js";

const BASE = "https://pbcards.dk";

// Butikken sælger også Lorcana, One Piece, Magic og Riftbound. Pokémon-varerne
// har alle "Pokémon Trading Card Game" som vendor, og butikkens egne
// akrylkasser til Pokémon-bokse røber sig kun i titlen.
export const shop = {
    id: "pbcards",
    name: "PBCards",
    needsBrowser: false,

    scrape: (_page, log) => scrapeShopify({ base: BASE, keep: isPokemon }, log),
};

function isPokemon(product) {
    return POKEMON.test(product.vendor ?? "") || POKEMON.test(product.title ?? "");
}

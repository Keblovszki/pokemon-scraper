// Butikkerne botten kender. Worker'en slår pæne navne op her, og
// command-setup.js bygger valgmulighederne i /watch ud af den samme liste, så
// Discord-siden af en ny butik kun skal skrives ét sted.
export const SHOPS = [
    // Proshops bot-beskyttelse afviser de fleste kørsler fra GitHubs runnere.
    // Den scrapes kun på hele timer, og der kan gå et døgn mellem snapshots
    // uden at noget er galt.
    { id: "proshop", name: "Proshop", hourly: true, staleMinutes: 1440 },
    { id: "mtgwebshop", name: "MTGwebshop" },
    { id: "pbcards", name: "PBCards" },
    { id: "mugglealley", name: "Muggle Alley" },
    { id: "kelz0r", name: "Kelz0r" },
    { id: "matraws", name: "Matraws" },
];

// Hvor mange millisekunder en butik må tie før vagthunden melder den. En butik
// kan sætte sin egen grænse; ellers gælder STALE_MINUTES.
export function staleAfterMs(shopId, env) {
    const own = SHOPS.find(s => s.id === shopId)?.staleMinutes;
    return Number(own ?? env.STALE_MINUTES ?? 45) * 60000;
}

# Scraper-agenten

Åbner Chrome, henter varelisterne og sender dem til worker'en. Se hovedprojektets
[README](../README.md) for opsætningen af selve botten.

```bash
npm install
cp .env.example .env
npm start
```

## Flag

| Flag | Hvad det gør |
| --- | --- |
| `--once` | Én runde, så stop. Godt til en planlagt opgave |
| `--dry-run` | Scrape og print resultatet uden at sende noget. Kræver ingen `.env` |
| `--visible` | Vis Chrome-vinduet på skærmen i stedet for uden for den |
| `--shop=proshop` | Kun én butik |

`npm run dry` er `--once --dry-run`. Start altid dér når du har rørt en adapter.

## Chrome-vinduet

Proshop er bag Cloudflares bot-beskyttelse, og headless kommer ikke igennem — hverken
Playwrights Chromium eller rigtig Chrome. Derfor kører agenten med et **synligt** Chrome, blot
placeret uden for skærmen. Prøv ikke at gøre det headless; scraperen bliver blind, ikke hurtigere.

Konsekvenser:

- Der skal være en grafisk session. På Windows: en bruger der er logget ind.
- På en Linux-server skal processen pakkes i `xvfb-run -a npm start`.
- Profilen i `.browser-profile/` holder cookies mellem kørsler, så de fleste sidevisninger
  slipper direkte igennem. Slet mappen hvis browseren sætter sig fast.

## Kør den hele tiden

`npm start` kører selv i ring med `INTERVAL_MINUTES` mellem runderne. Vil du have den til at
starte med maskinen, er den nemmeste vej på Windows en opgave i Task Scheduler:

- Trigger: *At log on*
- Handling: `npm` med argumentet `start` i denne mappe
- *Run only when user is logged on* — vinduet kræver en grafisk session

Alternativt en planlagt opgave hvert 10. minut der kører `npm run once`. Så er der ingen
langtidskørende proces, men Chrome skal starte forfra hver gang.

## Når en adapter holder op med at virke

Butikker ændrer deres HTML. Symptomet er enten 0 varer eller en advarsel i driftskanalen om
mange ukendte varer.

1. `npm run dry -- --visible` — så kan du se hvad browseren ser.
2. Tjek selectorne i `src/shops/proshop.js` mod siden.

Worker'en holder alarmerne tilbage i mellemtiden, så der kommer ikke spam ud af det.

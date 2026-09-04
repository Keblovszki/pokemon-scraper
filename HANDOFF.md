# Handoff — hvor projektet står

Skrevet 2026-08-31, opdateret 2026-09-01. Læs [README.md](README.md) for hvordan projektet er
bygget; denne fil er kun status og næste skridt.

## Hvad projektet er

En Discord-bot der overvåger webshops for Pokémon-varer og melder **nye varer**, **restock** og
**prisfald**. Butikkerne er Proshop, MTGwebshop og PBCards. Botten er en anden bot end `eloranking` — egen
Discord-app, eget projekt — men bruger samme mønster: Cloudflare Worker, HTTP-interactions,
MongoDB.

## Status: i drift

Hele kæden er sat op og kørt igennem 2026-09-01. Der er ikke noget udestående opsætningsskridt.

- **Worker'en er live** på `https://pokemon-scraper-bot.keblovszki.workers.dev` med alle fire
  hemmeligheder sat og `ADMIN_CHANNEL_ID` bundet til driftskanalen.
- **Databasen svarer.** MongoDB Atlas, samme cluster som elo-botten, egen database
  `pokemon_scraper`. Network Access står på `0.0.0.0/0`.
- **Discord er koblet på:** interactions-endpointet er godkendt, de syv slash-kommandoer er
  registreret globalt, og mindst én `/watch` er oprettet.
- **Repoet er offentligt:** [github.com/Keblovszki/pokemon-scraper](https://github.com/Keblovszki/pokemon-scraper),
  med `WORKER_URL` og `INGEST_SECRET` som Actions-secrets.
- **Scrape-jobbet kører hvert kvarter**, startet af worker'ens cron. Første kørsel tog 23
  sekunder; Chrome kørte headed under `xvfb-run` uden at Proshop opdagede noget.
- **11/11 tests grønne** (`cd worker && npm test`).

Sådan så første rigtige kørsel ud, og sådan ser en sund kørsel altså ud:

```
proshop: 148 varer på 8s (komplet: true)
proshop: Worker svarede: {"saved":148,"events":1,"alerts":1}
```

## At tilføje en butik

En butik er én fil i `scraper/src/shops/`, registreret to steder: `scraper/src/shops/index.js`
og `worker/src/shops-list.js`. Diff-logikken er butiksuafhængig, så der skal ikke røres noget
i worker'en ud over navnet. Kør `node command-setup.js` bagefter, ellers mangler butikken i
`/watch`s valgmuligheder.

Adapteren returnerer `{ products, complete }`, hvor hver vare har `productId`, `name`, `url`,
`image`, `price`, `normalPrice`, `inStock` og `stockText`. `complete: false` betyder "det her er
ikke hele butikken", og worker'en holder så igen med alarmerne.

**Kig efter en JSON-kilde før du skriver selectorer.** MTGwebshop og PBCards kører begge på
Shopify, hvor hele kataloget ligger på `/products.json?limit=250&page=N`. Hentningen og
feltopsætningen ligger i `scraper/src/shops/shopify.js`, så en Shopify-butik er ét filter og
en adresse — ingen selectorer der kan knække, og ingen browser: de sætter `needsBrowser: false`,
og så åbner agenten ikke Chrome for dem. Proshop er undtagelsen, ikke reglen.

**Kun kortspillet.** Botten skal følge Pokémon TCG, ikke bamser og figurer. Proshop henter
derfor `/pokemon-kort` (20 varer) i stedet for `/Pokemon` (147). MTGwebshop tager alt med
`vendor: "Pokémon"` plus tilbehør til kortene, og udelukker i stedet Funko og Squishmallow ved
navn — listen er vendt om med vilje, så en ny mærkevare med lommer kommer med af sig selv. Det
giver omkring 505 varer. PBCards er ren kortbutik: alle Pokémon-varer har vendor
`Pokémon Trading Card Game`, og filteret tager desuden titler med Pokémon i, hvilket kun er
butikkens egne akrylkasser til boksene. Det giver 89 af butikkens 133 varer.

**Databasen følger med filtreringen.** Et komplet snapshot rydder op efter sig: varer der ikke er
med, bliver slettet. Det gælder både varer butikken har taget af hylden og varer en ny filtrering
har sorteret fra, så `/shops`, `/search` og `/latest` ikke bliver ved med at vise bamser efter at
adapteren er holdt op med at hente dem. Oprydningen holder igen ved `complete: false`, ved et tomt
snapshot og når varenumrene ser ud til at være skiftet — samme spærre som alarmerne. Antallet står
som `removed` i worker'ens svar.

## Hvem starter scrapingen

Worker'ens cron kalder GitHubs `workflow_dispatch`-API hvert kvarter. Workflowet lytter **kun**
på dispatch; `schedule` er taget ud med vilje.

GitHubs egen `schedule` blev prøvet 2026-09-01 og fyrede ikke en eneste gang på to en halv
time, selvom workflowet stod som `active`. Planlagte kørsler bliver forsinket eller droppet når
der er pres på de delte runnere, og et kvartersinterval rammer netop de klokkeslæt hvor presset
er størst. Cloudflares cron har ikke det problem. Læg den ikke tilbage.

Det kræver et fine-grained GitHub-token med `Actions: Read and write` på dette ene repo, sat som
worker-secret `GITHUB_TOKEN`. **Tokenet udløber**, og den dag det sker, stopper scrapingen —
vagthunden melder det i driftskanalen inden for 45 minutter, og fejlen står i worker-loggen som
`Kunne ikke starte scrape-jobbet: 401`.

## Hvis noget går galt

- **Ingen beskeder i flere timer.** Kig i driftskanalen. Vagthunden melder efter 45 minutters
  tavshed, én gang pr. stilhed. Kommer der intet, kører scraperen, men finder ingen ændringer.
- **Actions fejler.** `gh run list --limit 5` og `gh run view <id> --log`. Er det Proshop der
  giver 403, så læs afsnittet nedenfor før du prøver at fikse det.
- **Alarmer udebliver, men snapshots kommer ind.** `/watches` i Discord. `alerts: 0` i loggen
  med `events` over 0 betyder at ingen overvågning matchede.
- **Start altid med `npm run dry`** i `scraper/`. Den scraper og printer uden at sende noget og
  kræver ingen opsætning.

## Ting der ikke skal undersøges igen

Alt herunder er målt 2026-08-31, fra samme IP, inden for få minutter. Det er lagt fast fordi
det ser ud som oplagte forbedringer og alle er blindgyder:

| Forsøg | Resultat |
| --- | --- |
| `curl` med browser-UA, HTTP/2 og HTTP/1.1 | 403 |
| Node `fetch()` (undici) | 403 |
| Playwright-Chromium, headless | 403, fastlåst på challenge |
| Rigtig Chrome, headless | 403, fastlåst |
| Rigtig Chrome, `--headless=new` | 403, fastlåst |
| Rigtig Chrome, headless + varm cookie-profil | 403, fastlåst |
| Proshops eget JSON-API (`/api/facets`, `/api/MiniBasket`) | 403 |
| `/Feeds/*` | Når origin, men der ligger intet produktfeed |
| **Rigtig Chrome med vindue** | **200, ingen challenge** |

Samme IP hele vejen, så det er browserens fingerprint der afgør det — ikke IP, netværk,
User-Agent eller cookies.

**Konsekvenser, som ikke skal laves om:**

- Scraperen **skal** køre headed. `scraper/src/browser.js` har `headless: false` og et
  `--window-position=-32000,-32000` der lægger vinduet uden for skærmen. Gør den ikke headless
  — den bliver blind, ikke hurtigere.
- Den skal bruge **rigtig Chrome** (`channel: "chrome"`), ikke Playwrights Chromium.
- Derfor kan hentningen ikke ligge i Worker'en, og GitHub Actions kører den under `xvfb-run`.
- Cloudflare Browser Rendering er headless Chrome og løber efter alt at dømme ind i samme mur.
  Brugerens konto *har* `browser (write)`-scope, så det kan afprøves, men forvent et nej.

## Åbne beslutninger brugeren har truffet

- Arkitektur: hybrid Worker + separat scraper (ikke alt i én Node-proces)
- Fuld bot med slash-kommandoer (ikke bare webhook-beskeder)
- Alle tre alarmtyper: nye varer, restock, prisfald
- Scraperen skal køre uden at brugerens computer er tændt → derfor GitHub Actions

## Kendt hul, ikke bygget

En vare der går fra **ingen pris** til **at have en pris** udløser ingen alarm. 5 af de ~148
Proshop-varer er annonceret uden pris og gemmes med `price: null`; prisfald kræver en tidligere
pris. De udløser til gengæld restock den dag de kan købes, hvilket nok er det øjeblik der
betyder noget. Brugeren er blevet spurgt og har ikke bedt om en fjerde alarmtype.

## Praktisk

- Repoet ligger offentligt på GitHub som `Keblovszki/pokemon-scraper`, gren `main`.
- `.gitignore` dækker `node_modules/`, `.dev.vars`, `.env`, `.wrangler/`, `.browser-profile/`
  og `.idea/`.
- Cloudflare-konto: den konto wrangler allerede er logget ind med lokalt.
- `npm run dry` i `scraper/` scraper og printer resultatet uden at sende noget, og kræver ingen
  opsætning. Start altid dér hvis noget ser forkert ud.

# Handoff — hvor projektet står

Skrevet 2026-08-31, opdateret 2026-09-01. Læs [README.md](README.md) for hvordan projektet er
bygget; denne fil er kun status og næste skridt.

## Hvad projektet er

En Discord-bot der overvåger webshops for Pokémon-varer og melder **nye varer**, **restock** og
**prisfald**. Butikkerne er Proshop, MTGwebshop, PBCards,
Muggle Alley og Kelz0r. Botten er en anden bot end `eloranking` — egen
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
- **Scrape-jobbet kører hvert kvarter**, startet af worker'ens cron, og Muggle Alley alene hvert
  5. minut imellem kvartererne (se nedenfor). Første kørsel tog 23
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

**Kig efter en JSON-kilde før du skriver selectorer.** Tre af de fem butikker har en:

- **MTGwebshop og PBCards** kører på Shopify, hvor hele kataloget ligger på
  `/products.json?limit=250&page=N`. Hentningen og feltopsætningen ligger i
  `scraper/src/shops/shopify.js`, så en Shopify-butik er en adresse og et filter.
- **Muggle Alley** kører på Smartweb. Siden ser ud som almindelig HTML, men varelisten hentes af
  et AngularJS-frontend fra `/json/products`, og vi spørger samme endpoint direkte.
  `field=category` uden en rigtig kategori giver hele butikken, og `amount` i svaret fortæller
  hvornår vi har det hele. Ser en butik sådan ud, så kig efter `ng-repeat` i HTML'en og søg
  bagefter i butikkens `app.js` efter dens `$resource`-adresse.

**Findes der ingen, så led efter microdata.** Kelz0r er en Zen Cart uden JSON-kilde, men hver
vare er mærket op med schema.org: navn, adresse, billede, pris og lagerstatus står i
`itemprop`-attributter. Det er butikkens data, ikke dens design, så de flytter sig ikke når
nogen skifter tema. Adapteren klipper siden op på `itemtype="http://schema.org/Product"` og
læser felterne ud af hvert stykke — men kun inden for varens eget `itemprop="offers"`, for det
sidste stykke på siden slæber resten af sidens HTML med sig, sidebar og overstregede
tilbudspriser og det hele.

To fælder i Kelz0rs data, som allerede er lukket: varer butikken ikke sælger står til
**999999 kr**, og gemte vi det tal, ville varen udløse et gigantisk prisfald den dag den kom til
salg igen — de gemmes uden pris. Og varens adresse slæber en sessionsnøgle med sig, som er ny
hver gang, så forespørgslen skæres af.

Alle fire sætter `needsBrowser: false`, og så åbner agenten ikke Chrome for dem. Proshop er
undtagelsen, ikke reglen.

**Kun kortspillet.** Botten skal følge Pokémon TCG, ikke bamser og figurer. Proshop henter
derfor `/pokemon-kort` (20 varer) i stedet for `/Pokemon` (147). MTGwebshop tager alt med
`vendor: "Pokémon"` plus tilbehør til kortene, og udelukker i stedet Funko og Squishmallow ved
navn — listen er vendt om med vilje, så en ny mærkevare med lommer kommer med af sig selv. Det
giver omkring 505 varer. PBCards er ren kortbutik: alle Pokémon-varer har vendor
`Pokémon Trading Card Game`, og filteret tager desuden titler med Pokémon i, hvilket kun er
butikkens egne akrylkasser til boksene. Det giver 89 af butikkens 133 varer. Muggle Alley
filtreres på varens kategori, som står i dens adresse, og udelader bamser og figurer både på
kategori og på titel. Det giver 331 af butikkens 524 varer. Kelz0r behøver slet ikke
et filter: alt under kategori 187 er kortspillet, og underkategorierne læses af rodsiden, så en
ny kategori kommer med af sig selv. Det giver 3821 varer — flere end de andre fire tilsammen.

**Databasen følger med filtreringen.** Et komplet snapshot rydder op efter sig: varer der ikke har
været med i tre timer, bliver slettet. Fristen er der fordi Kelz0r bytter varer med samme navn
rundt mellem to sider, så én vare kan mangle i et enkelt snapshot og være tilbage i det næste —
blev den slettet straks, gav den en ny "Ny vare"-alarm hver gang. Det gælder både varer butikken har taget af hylden og varer en ny filtrering
har sorteret fra, så `/shops`, `/search` og `/latest` ikke bliver ved med at vise bamser efter at
adapteren er holdt op med at hente dem. Oprydningen holder igen ved `complete: false`, ved et tomt
snapshot og når varenumrene ser ud til at være skiftet — samme spærre som alarmerne. Antallet står
som `removed` i worker'ens svar.

**Store snapshots skal skrives i bidder.** Kelz0rs 3821 varer i én `bulkWrite` slog worker'en
ihjel med `Worker exceeded CPU time limit`, og snapshottet nåede aldrig i databasen — scraperen
prøvede tre gange og gav op. Prisen for at pakke skrivningerne vokser hurtigere end antallet, så
de sendes 250 ad gangen; så koster den samme kørsel 480 ms CPU. Af samme grund sletter
oprydningen efter `lastSeen` i stedet for efter en liste med alle varenumrene. Læg dem ikke
tilbage i én forespørgsel, næste butik kan være endnu større.

**Kelz0r er den tunge.** Butikken viser 40 varer pr. side og lader sig ikke overtale til flere,
så en kørsel er omkring hundrede sideopslag og tager 75 sekunder. Det er stadig hurtigere end
Proshops tyve varer, fordi der ikke skal startes en browser, men det er også hundrede
forespørgsler hvert kvarter til en lille dansk butik. Der er en halv sekunds pause mellem
siderne med vilje. Sæt den ikke ned.

## Hvem starter scrapingen

Worker'ens cron fyrer hvert 5. minut og kalder GitHubs `workflow_dispatch`-API. På kvartererne
sendes intet input, og workflowet scraper alle butikker. I minutterne imellem sendes
`inputs.shop = FAST_SHOP` (sat i `wrangler.toml`, i dag `mugglealley`), og jobbet kører så
`npm run once -- --shop=mugglealley`. Muggle Alley er valgt fordi den koster tre JSON-kald og
ingen browser, så 36 kald i timen er mindre end én kunde der klikker rundt. Sæt ikke Kelz0r
eller Proshop ind der: Kelz0r er hundrede sideopslag pr. kørsel, og Proshop skal have Chrome op.
Tom `FAST_SHOP` slår de ekstra kørsler fra igen. Workflowet lytter **kun** på dispatch;
`schedule` er taget ud med vilje.

Kørslerne hedder `Scrape alle butikker` og `Scrape mugglealley` i Actions, så `gh run list`
viser hvad der blev kørt. `concurrency` lader dem stå i kø efter hinanden, ikke køre samtidig.

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

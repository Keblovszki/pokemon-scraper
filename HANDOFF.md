# Handoff — hvor projektet står

Skrevet 2026-08-31. Læs [README.md](README.md) for hvordan projektet er bygget; denne fil er
kun status og næste skridt.

## Hvad projektet er

En Discord-bot der overvåger webshops for Pokémon-varer og melder **nye varer**, **restock** og
**prisfald**. Første butik er Proshop. Botten er en anden bot end `eloranking` — egen
Discord-app, eget projekt — men bruger samme mønster: Cloudflare Worker, HTTP-interactions,
MongoDB.

## Færdigt og afprøvet

- **Al kode er skrevet.** `worker/` (Discord, diff, database, 7 slash-kommandoer) og
  `scraper/` (Playwright-agent med Proshop-adapter).
- **Proshop-adapteren er kørt mod den rigtige side:** 176 varer på ~4 sekunder over 2
  sidevisninger. Alle selectorer virker.
- **11/11 tests grønne** (`cd worker && npm test`) — filterlogik og rettighedstjek.
- **Worker'en er deployet og live:**
  `https://pokemon-scraper-bot.keblovszki.workers.dev`
  `/health` svarer `{"ok":true}`, `/ingest` uden nøgle giver 401, Discord-endpointet uden
  gyldig signatur giver 401. Cron `*/15 * * * *` er registreret.
- **Botten er inviteret til Discord-serveren** med `permissions=19456`.
- **GitHub Actions-workflowet er skrevet** (`.github/workflows/scrape.yml`, YAML valideret),
  men aldrig kørt.

## Ikke gjort endnu

Intet virker endnu. Rækkefølgen herunder er den der mangler.

### 1. Sæt de fire hemmeligheder på worker'en

Brugeren skal selv køre disse i sit eget PowerShell-vindue — `wrangler` spørger interaktivt, så
værdierne havner ikke i samtalen:

```powershell
cd C:\Projects\discord\pokemon-scraper\worker
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put MONGODB_URI
npx wrangler secret put INGEST_SECRET
```

- `DISCORD_PUBLIC_KEY` og `DISCORD_BOT_TOKEN`: fra Discord Developer Portal. Brugeren havde dem
  i Notepad 2026-08-31; er de væk, kan token'et nulstilles igen under **Bot → Reset Token**.
- `MONGODB_URI`: MongoDB Atlas → cluster → **Connect → Drivers**. Elo-bottens cluster kan
  genbruges; koden bruger sin egen database, `pokemon_scraper`. **Network Access skal være
  `0.0.0.0/0`** — Workers har ingen fast IP.
- `INGEST_SECRET`: `node -e "console.log(crypto.randomUUID())"`. Skal bruges to steder — her og
  som GitHub-secret i skridt 4.

### 2. Sæt driftskanalen ind

Mangler brugerens kanal-id. Sæt `ADMIN_CHANNEL_ID = "<id>"` i `worker/wrangler.toml` og kør
`npx wrangler deploy` igen. Det er kanalen der får seeding-kvittering og
"scraperen er tavs"-advarsler.

Kanal-id: Discord → **Indstillinger → Avanceret → Udviklertilstand** til, højreklik på
kanalen → **Kopiér kanal-id**.

### 3. Kobl Discord på og registrér kommandoerne

I Developer Portal → **General Information** → *Interactions Endpoint URL*:

```
https://pokemon-scraper-bot.keblovszki.workers.dev/
```

Discord sender straks en PING. Fejler den, er `DISCORD_PUBLIC_KEY` forkert.

Derefter, med brugerens Application ID og bot-token:

```powershell
cd C:\Projects\discord\pokemon-scraper\worker
$env:APP_ID="..."; $env:BOT_TOKEN="..."; node command-setup.js
```

### 4. Læg projektet på GitHub og start cronjobbet

Repoet skal være **offentligt** — der er ingen hemmeligheder i koden, og offentlige repos har
gratis ubegrænsede Actions-minutter. Et privat repo bruger hele den gratis kvote på dette
interval.

```powershell
cd C:\Projects\discord\pokemon-scraper
git add -A
git commit -m "Pokemon-vagten"
gh repo create pokemon-scraper --public --source=. --push
```

Sæt to secrets under **Settings → Secrets and variables → Actions**:

| Secret | Værdi |
| --- | --- |
| `WORKER_URL` | `https://pokemon-scraper-bot.keblovszki.workers.dev` (uden skråstreg til slut) |
| `INGEST_SECRET` | Samme værdi som worker'ens |

Kør så **Actions → Scrape butikker → Run workflow** manuelt første gang.

### 5. Tjek at det virker

1. Driftskanalen får `✅ Proshop er nu i databasen med ~175 varer` — det er seedingen
2. `/shops` i Discord → 🟢 Proshop, "lige nu"
3. `/watch keyword:elite trainer box` i den kanal der skal have alarmer
4. Alarmer kommer først fra **andet** snapshot. Første er kun seeding, ellers ville der komme
   175 beskeder på én gang

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

En vare der går fra **ingen pris** til **at have en pris** udløser ingen alarm. 5 af de 176
Proshop-varer er annonceret uden pris og gemmes med `price: null`; prisfald kræver en tidligere
pris. De udløser til gengæld restock den dag de kan købes, hvilket nok er det øjeblik der
betyder noget. Brugeren er blevet spurgt og har ikke bedt om en fjerde alarmtype.

## Praktisk

- Git-repoet er initialiseret, men **der er ikke committet noget endnu**.
- `.gitignore` dækker `node_modules/`, `.dev.vars`, `.env`, `.wrangler/`, `.browser-profile/`
  og `.idea/`.
- Cloudflare-konto: `hannibalkk1337@gmail.com`, wrangler er logget ind.
- `npm run dry` i `scraper/` scraper og printer resultatet uden at sende noget, og kræver ingen
  opsætning. Start altid dér hvis noget ser forkert ud.

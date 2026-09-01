# Pokémon-vagten

En Discord-bot der holder øje med webshops og melder når der sker noget med Pokémon-varer:
**nye varer**, **restock** og **prisfald**. Første butik er Proshop.

## Sådan hænger det sammen

```
   Proshop  ──►  scraper-agent  ──POST /ingest──►  Cloudflare Worker  ──►  Discord
              (Chrome, hvert 15. min)             (diff + MongoDB,
                                                   slash-kommandoer)
```

Scraper-agenten kan køre to steder: på **GitHub Actions** (gratis, ingen maskine af din egen
tændt) eller på **din egen PC**. Koden er den samme.

Projektet er delt i to fordi Proshop ligger bag Cloudflares bot-beskyttelse. Et almindeligt
`fetch()` — også fra en Worker — får en JS-challenge og aldrig noget indhold. Kun et **rigtigt
Chrome-vindue** slipper igennem; headless bliver holdt tilbage uanset User-Agent og cookies.

Derfor:

- **`worker/`** — Cloudflare Worker. Tager imod snapshots, finder ud af hvad der er nyt, gemmer
  i MongoDB og sender alarmer. Håndterer også slash-kommandoerne. Kører altid.
- **`scraper/`** — en lille Node-proces der åbner Chrome, henter varelisterne og sender dem til
  worker'en. Kører på GitHub Actions eller på din PC, og kan flyttes mellem dem uden at røre
  botten.

Worker'en er den der ejer tilstanden. Scraperen er med vilje dum: den sender bare "sådan ser
butikken ud lige nu".

## Kom i gang

### 1. Forudsætninger

- [Node.js](https://nodejs.org/) LTS. Google Chrome hvis du vil køre scraperen lokalt
  (GitHub Actions har den selv)
- En [Cloudflare-konto](https://dash.cloudflare.com/) og en [GitHub-konto](https://github.com/)
  (begge gratis)
- En [Discord-applikation](https://discord.com/developers/applications) — en **ny**, ikke den
  Elo-botten bruger
- En [MongoDB-database](https://www.mongodb.com/atlas) (fx gratis Atlas)

### 2. Deploy worker'en

```bash
cd worker
npm install
npx wrangler deploy
```

Sæt hemmeligheder. `INGEST_SECRET` er den nøgle scraperen bruger — generér den med
`node -e "console.log(crypto.randomUUID())"`:

```bash
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put MONGODB_URI
npx wrangler secret put INGEST_SECRET
```

Skriv id'et på din driftskanal i `ADMIN_CHANNEL_ID` i `wrangler.toml` og deploy igen. Det er
kanalen der får seeding-kvitteringer og "scraperen er tavs"-advarsler.

### 3. Kobl Discord på

I Developer Portal → din app → **General Information** sættes *Interactions Endpoint URL* til
worker'ens rod-URL:

```
https://pokemon-scraper-bot.<dit-subdomain>.workers.dev/
```

Discord verificerer med en PING med det samme, så worker'en skal være deployet først.

Registrér kommandoerne:

```bash
APP_ID=... BOT_TOKEN=... node command-setup.js            # Git Bash
$env:APP_ID="..."; $env:BOT_TOKEN="..."; node command-setup.js   # PowerShell
```

Invitér så botten. Se afsnittet [Rettigheder](#rettigheder) nedenfor for den færdige URL.

### 4. Start scraperen

Vælg ét af de to steder. **A er anbefalet** — så er der ingen maskine af din egen der skal
være tændt.

#### A: GitHub Actions (gratis, ingen egen maskine)

Læg projektet op i et **offentligt** GitHub-repo. Der er ingen hemmeligheder i koden — de
ligger i GitHub Secrets — og offentlige repos har gratis ubegrænsede Actions-minutter. Et
privat repo bruger ~2.000 min/md på dette interval, hvilket er hele den gratis kvote.

```bash
git add -A
git commit -m "Pokémon-vagten"
gh repo create pokemon-scraper --public --source=. --push
```

Sæt to secrets under **Settings → Secrets and variables → Actions**:

| Secret | Værdi |
| --- | --- |
| `WORKER_URL` | Worker-URL'en fra trin 2, uden skråstreg til slut |
| `INGEST_SECRET` | Samme værdi som worker'ens `INGEST_SECRET` |

Kør den så manuelt første gang: **Actions → Scrape butikker → Run workflow**. Derefter kører
den selv hvert kvarter. GitHub kan forsinke planlagte kørsler når der er travlt, så regn med
15-30 minutter i praksis.

Bemærk: GitHub slår planlagte workflows fra i repos uden aktivitet i 60 dage. Så skal du bare
trykke **Run workflow** igen.

#### B: Din egen PC

```bash
cd scraper
npm install
cp .env.example .env      # udfyld WORKER_URL og INGEST_SECRET
npm start
```

`npm start` kører selv i ring. Der skal være en bruger logget ind, for Chrome skal have et
vindue. Se [scraper/README.md](scraper/README.md) for at starte den med maskinen.

Prøv `npm run dry` først, uanset hvad du vælger: den scraper og printer resultatet uden at
sende noget, og kræver ingen opsætning.

Første rigtige snapshot **seeder** databasen — alle varer gemmes uden alarmer, og du får én
kvittering i driftskanalen. Ellers ville du få 175 beskeder på én gang. Alarmer starter ved
andet snapshot.

## Rettigheder

Botten skal have tre rettigheder, og ikke flere:

| Rettighed | Hvorfor |
| --- | --- |
| Vis kanal | Ellers findes kanalen ikke for botten |
| Send beskeder | Alarmerne sendes som almindelige beskeder |
| Indlejr links | Alarmerne er embeds med billede og pris |

Det giver `permissions=19456`. Indsæt dit Application ID i denne URL og åbn den:

```
https://discord.com/oauth2/authorize?client_id=DIT_APPLICATION_ID&scope=bot+applications.commands&permissions=19456
```

Rettighederne skal gælde i **hver kanal du vil have alarmer i**, og i driftskanalen
(`ADMIN_CHANNEL_ID`). Har du private kanaler med egne tilladelser, skal botten tilføjes der.

**Ingen intents.** Botten taler kun med Discord over HTTP-interactions og læser ingen beskeder,
så du skal ikke slå *Message Content Intent* eller andre privilegerede intents til.

To ting der ofte forveksles:

- **Bottens rettigheder** — dem ovenfor. Uden dem kan alarmerne ikke sendes.
- **Brugernes rettigheder** — `/watch` og `/unwatch` kræver *Manage Server* af den der kører
  dem, fordi de bestemmer hvad hele kanalen bliver fyldt med. Det sidder på kommandoen og kan
  ændres i Discord under **Server Settings → Integrations**.

Svaret på en slash-kommando kommer altid frem, også uden rettigheder — det går gennem
interaktionens eget token. Derfor tjekker `/watch` hvad botten faktisk må i kanalen og siger
det direkte, i stedet for at kvittere glad og lade alarmerne fejle i tavshed bagefter.

## Kommandoer

| Kommando | Hvad den gør |
| --- | --- |
| `/watch` | Overvåg i denne kanal. `keyword`, `shop`, `events`, `max_price`, `min_drop` |
| `/watches` | Se alt der overvåges, med koderne til `/unwatch` |
| `/unwatch` | Stop en overvågning ud fra dens kode |
| `/shops` | Hvornår hver butik sidst blev tjekket, og om scraperen er sund |
| `/latest` | De senest opdagede varer |
| `/search` | Søg i de varer botten har set |
| `/help` | Kort forklaring |

`/watch` og `/unwatch` kræver *Manage Server*, for de bestemmer hvad hele kanalen får.

Eksempler:

```
/watch keyword:elite trainer box events:Nye varer + restock
/watch keyword:booster box max_price:1200
/watch events:Kun prisfald min_drop:20
```

## De tre hændelsestyper

| Type | Udløses når |
| --- | --- |
| Ny vare | Et varenummer vi ikke har set før i butikken |
| Restock | Kendt vare går fra bestillingsvare til på lager |
| Prisfald | Kendt vare falder i pris, som standard mindst 5 % |

Nogle varer er annonceret uden pris endnu. De gemmes med `price: null` og udløser restock den
dag de kan købes.

## Tilføj en butik

1. Lav `scraper/src/shops/<butik>.js` med et objekt der har `id`, `name` og
   `scrape(page, log)`. Den skal returnere `{ products, complete }`, hvor hver vare har
   `productId`, `name`, `url`, `image`, `price`, `normalPrice`, `inStock` og `stockText`.
2. Tilføj den i `scraper/src/shops/index.js`.
3. Tilføj `{ id, name }` i `worker/src/shops-list.js` og kør `node command-setup.js` igen, så
   butikken kan vælges i `/watch`.

Resten — diff, alarmer, kommandoer — virker uden ændringer.

## Sikkerhedsnet

Botten er bygget til at holde kæft når noget er gået i stykker, i stedet for at spamme:

- Et **tomt snapshot** afvises med 400. En fejlet scrape må ikke få `/shops` til at lyse grønt.
- **Over 30 ukendte varer** i ét snapshot betyder næsten altid at butikken har ændret sine
  varenumre. Varerne gemmes, alarmerne holdes tilbage, og driftskanalen får en advarsel.
- **Højst 25 alarmer pr. kanal pr. snapshot**, resten opsummeres i én linje.
- En **watchdog** kører hvert kvarter og siger til hvis en butik ikke har sendt noget i 45
  minutter (`STALE_MINUTES`). Én advarsel pr. stilhed.

## Test

```bash
cd worker && npm test
```

## Hensyn til butikken

Scraperen henter to sider hvert tiende minut med to sekunders pause imellem, plus lidt slør på
intervallet. Skru ikke `INTERVAL_MINUTES` unødigt ned — det er en almindelig webshop, ikke et
API, og de har ingen forpligtelse til at holde os kørende.

// Læser hemmeligheder fra miljøvariabler — commit ALDRIG din bot-token!
// Sæt dem før du kører scriptet, fx:
//   APP_ID=... BOT_TOKEN=... node command-setup.js            (Git Bash)
//   $env:APP_ID="..."; $env:BOT_TOKEN="..."; node command-setup.js   (PowerShell)
import { SHOPS } from "./src/shops-list.js";

const APP_ID = process.env.APP_ID;
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!APP_ID || !BOT_TOKEN) {
    console.error("❌ Mangler APP_ID og/eller BOT_TOKEN som miljøvariabler. Se README.md.");
    process.exit(1);
}

const STRING = 3;
const INTEGER = 4;
const BOOLEAN = 5;
const NUMBER = 10;

// MANAGE_GUILD. Overvågninger bestemmer hvad hele kanalen bliver spammet med,
// så det er ikke noget enhver skal kunne ændre.
const MANAGE_GUILD = "32";

const shopChoices = SHOPS.map(shop => ({ name: shop.name, value: shop.id }));

const ALL_COMMANDS = [
    {
        name: "watch",
        description: "Overvåg varer i denne kanal",
        type: 1,
        default_member_permissions: MANAGE_GUILD,
        options: [
            {
                name: "keyword",
                description: 'Kun varer med disse ord i navnet, fx "elite trainer box". Tom = alt',
                type: STRING,
                required: false,
            },
            {
                name: "shop",
                description: "Kun denne butik (standard: alle)",
                type: STRING,
                required: false,
                choices: shopChoices,
            },
            {
                name: "events",
                description: "Hvad der skal meldes om (standard: alt)",
                type: STRING,
                required: false,
                choices: [
                    { name: "Alt", value: "alle" },
                    { name: "Kun nye varer", value: "new" },
                    { name: "Kun restock", value: "restock" },
                    { name: "Kun prisfald", value: "price_drop" },
                    { name: "Nye varer + restock", value: "new_restock" },
                ],
            },
            {
                name: "max_price",
                description: "Meld kun varer til og med denne pris i kr.",
                type: NUMBER,
                required: false,
                min_value: 0,
            },
            {
                name: "min_drop",
                description: "Meld kun prisfald på mindst så mange procent (standard: 5)",
                type: INTEGER,
                required: false,
                min_value: 1,
                max_value: 90,
            },
        ],
    },
    {
        name: "unwatch",
        description: "Stop en overvågning",
        type: 1,
        default_member_permissions: MANAGE_GUILD,
        options: [
            {
                name: "kode",
                description: "Koden fra /watches",
                type: STRING,
                required: true,
            },
        ],
    },
    { name: "watches", description: "Se hvad der overvåges på serveren", type: 1 },
    { name: "shops", description: "Se hvornår butikkerne sidst blev tjekket", type: 1 },
    {
        name: "latest",
        description: "Se de senest opdagede varer",
        type: 1,
        options: [
            {
                name: "shop",
                description: "Kun denne butik",
                type: STRING,
                required: false,
                choices: shopChoices,
            },
            {
                name: "antal",
                description: "Hvor mange (1-10, standard 5)",
                type: INTEGER,
                required: false,
                min_value: 1,
                max_value: 10,
            },
        ],
    },
    {
        name: "search",
        description: "Søg i de varer botten har set",
        type: 1,
        options: [
            { name: "keyword", description: "Hvad du søger efter", type: STRING, required: true },
            {
                name: "kun_paa_lager",
                description: "Skjul varer der ikke er på lager",
                type: BOOLEAN,
                required: false,
            },
        ],
    },
    { name: "help", description: "Sådan virker botten", type: 1 },
];

async function installCommands() {
    console.log(`Sender ${ALL_COMMANDS.length} kommandoer til Discord...`);

    const response = await fetch(`https://discord.com/api/v10/applications/${APP_ID}/commands`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bot ${BOT_TOKEN}`,
        },
        body: JSON.stringify(ALL_COMMANDS),
    });

    if (response.ok) {
        console.log("✅ Succes! Menuen er opdateret i Discord.");
    } else {
        console.error("❌ Fejl:", await response.text());
    }
}

await installCommands();

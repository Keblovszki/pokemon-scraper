import { InteractionType, InteractionResponseType, verifyKey } from "discord-interactions";
import { withDb, shops } from "./store.js";
import { ingestSnapshot } from "./ingest.js";
import { runCommand } from "./commands.js";
import { postMessage, staleWarning } from "./notify.js";

export default {
    async scheduled(event, env, ctx) {
        ctx.waitUntil(Promise.all([startScrape(env), watchdog(env)]));
    },

    async fetch(request, env, ctx) {
        const { pathname } = new URL(request.url);

        if (pathname === "/health") {
            return Response.json({ ok: true });
        }
        if (pathname === "/ingest") {
            return handleIngest(request, env);
        }
        return handleInteraction(request, env, ctx);
    },
};

async function handleInteraction(request, env, ctx) {
    const signature = request.headers.get("x-signature-ed25519");
    const timestamp = request.headers.get("x-signature-timestamp");
    const body = await request.arrayBuffer();

    const isValid = await verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY);
    if (!isValid) {
        // Discord viser "Applikationen svarede ikke" for alt der ikke er et
        // gyldigt svar, også et 401. Uden denne linje ser en afvist signatur ud
        // som en helt almindelig invocation i loggen.
        console.error(`Afvist signatur: sig=${!!signature} ts=${timestamp} bytes=${body.byteLength}`);
        return new Response("Invalid signature", { status: 401 });
    }

    const interaction = JSON.parse(new TextDecoder().decode(body));

    if (interaction.type === InteractionType.PING) {
        return Response.json({ type: InteractionResponseType.PONG });
    }

    if (interaction.type !== InteractionType.APPLICATION_COMMAND) {
        console.error(`Uventet interaktionstype: ${interaction.type}`);
        return new Response("Unsupported interaction", { status: 400 });
    }

    // Databasen svarer sjældent inden for de 3 sekunder Discord giver, så vi
    // kvitterer først og leverer svaret som en redigering bagefter.
    ctx.waitUntil(replyToCommand(interaction, env));

    return Response.json({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    });
}

async function replyToCommand(interaction, env) {
    const started = Date.now();
    const label = `${interaction.data.name} bruger=${interaction.member?.user?.id}`;

    let reply;
    try {
        reply = await withDb(env, db => runCommand(interaction, env, db));
    } catch (error) {
        console.error(`Fejl i kommando (${label}, ${Date.now() - started} ms):`, error);
        reply = { content: "❌ Der skete en uventet fejl. Prøv igen om lidt." };
    }
    await editReply(interaction, reply);
    console.log(`${label} leveret efter ${Date.now() - started} ms`);
}

// Interaction-tokenet er sin egen autentifikation — der skal ikke bot-token på.
async function editReply(interaction, reply) {
    const url = `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`;

    // Discord afviser en besked uden indhold, og så bliver kvitteringen stående
    // som en "tænker"-boble der aldrig bliver til noget.
    if (!reply?.content && !reply?.embeds?.length) {
        reply = { content: "Færdig." };
    }

    const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reply),
    });
    if (!res.ok) console.error(`Kunne ikke redigere svaret (${res.status}): ${await res.text()}`);
}

async function handleIngest(request, env) {
    if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
    }
    if (!env.INGEST_SECRET || request.headers.get("authorization") !== `Bearer ${env.INGEST_SECRET}`) {
        console.error("Afvist snapshot: forkert eller manglende INGEST_SECRET");
        return new Response("Unauthorized", { status: 401 });
    }

    let snapshot;
    try {
        snapshot = await request.json();
    } catch {
        return new Response("Ugyldig JSON", { status: 400 });
    }

    const problem = validateSnapshot(snapshot);
    if (problem) {
        console.error(`Afvist snapshot: ${problem}`);
        return new Response(problem, { status: 400 });
    }

    try {
        const result = await withDb(env, db => ingestSnapshot(env, db, snapshot));
        console.log(`Snapshot fra ${snapshot.shop}: ${JSON.stringify(result)}`);
        return Response.json(result);
    } catch (error) {
        console.error(`Kunne ikke behandle snapshot fra ${snapshot.shop}:`, error);
        return new Response("Ingest failed", { status: 500 });
    }
}

function validateSnapshot(snapshot) {
    if (!snapshot?.shop || typeof snapshot.shop !== "string") return "shop mangler";
    if (!snapshot.shopName) return "shopName mangler";
    if (!Array.isArray(snapshot.products)) return "products skal være et array";

    // Et tomt snapshot er en fejlet scrape, ikke en tom butik. Gemte vi det,
    // ville /shops stå og lyse grønt mens ingenting virkede.
    if (!snapshot.products.length) return "products er tomt";

    const bad = snapshot.products.find(
        p => !p?.productId || !p.name || !p.url || typeof p.inStock !== "boolean"
    );
    if (bad) return `vare mangler felter: ${JSON.stringify(bad).slice(0, 200)}`;

    return null;
}

// GitHubs egen "schedule" fyrede slet ikke i praksis — planlagte kørsler bliver
// forsinket eller droppet når der er pres på deres delte runnere, og et
// kvartersinterval rammer netop de klokkeslæt hvor presset er størst.
// Cloudflares cron er til gengæld pålidelig, så vi lader den bede GitHub om at
// køre jobbet i stedet. "workflow_dispatch" starter med det samme, hver gang.
async function startScrape(env) {
    if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return;

    const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW ?? "scrape.yml"}/dispatches`;
    const response = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            // GitHubs API afviser forespørgsler uden User-Agent med 403, og den
            // fejl ligner til forveksling et forkert token.
            "User-Agent": "pokemon-scraper-bot",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: env.GITHUB_REF ?? "main" }),
    });

    // Et vellykket dispatch svarer 204 uden indhold. Alt andet logges og lades
    // ligge: bliver det ved, opdager vagthunden det som manglende snapshots.
    if (response.status !== 204) {
        console.error(`Kunne ikke starte scrape-jobbet: ${response.status} ${await response.text()}`);
    }
}

async function watchdog(env) {
    const staleAfter = Number(env.STALE_MINUTES ?? 45) * 60000;

    await withDb(env, async db => {
        for (const shop of await shops(db).find({}).toArray()) {
            const silentFor = Date.now() - new Date(shop.lastScrapeAt).getTime();
            if (silentFor <= staleAfter) continue;

            // Én advarsel pr. stilhed. Et nyt snapshot er nyere end advarslen og
            // gør dermed automatisk plads til den næste.
            if (shop.staleWarnedAt && new Date(shop.staleWarnedAt) > new Date(shop.lastScrapeAt)) continue;

            await postMessage(env, env.ADMIN_CHANNEL_ID, {
                content: staleWarning(shop.name, shop.lastScrapeAt),
            });
            await shops(db).updateOne({ _id: shop._id }, { $set: { staleWarnedAt: new Date() } });
        }
    });
}

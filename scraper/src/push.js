const ATTEMPTS = 3;

export async function pushSnapshot({ workerUrl, ingestSecret }, shop, result, log) {
    const body = JSON.stringify({
        shop: shop.id,
        shopName: shop.name,
        scrapedAt: new Date().toISOString(),
        complete: result.complete,
        products: result.products,
    });

    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        let res;
        try {
            res = await fetch(`${workerUrl}/ingest`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${ingestSecret}`,
                },
                body,
            });
        } catch (error) {
            log(`Kunne ikke nå worker'en (forsøg ${attempt}/${ATTEMPTS}): ${error.message}`);
            await backoff(attempt);
            continue;
        }

        if (res.ok) {
            log(`Worker svarede: ${await res.text()}`);
            return true;
        }

        // 4xx betyder at snapshottet eller nøglen er forkert. Det bliver ikke
        // rigtigt af at blive sendt igen.
        if (res.status < 500) {
            log(`Worker afviste snapshottet (${res.status}): ${await res.text()}`);
            return false;
        }

        log(`Worker fejlede (${res.status}, forsøg ${attempt}/${ATTEMPTS})`);
        await backoff(attempt);
    }

    log("Gav op på at sende snapshottet");
    return false;
}

const backoff = attempt => new Promise(resolve => setTimeout(resolve, attempt * 3000));

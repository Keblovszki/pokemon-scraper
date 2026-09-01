import { chromium } from "playwright";

// Proshop ligger bag Cloudflares bot-beskyttelse, og den afgør sagen for hele
// opsætningen: headless bliver holdt på "Et øjeblik ..."-siden i det uendelige,
// både med Playwrights egen Chromium og med rigtig Chrome. Et almindeligt
// vindue slipper igennem med det samme. Skift derfor ikke til headless — det
// ser ud som en oplagt oprydning og gør scraperen fuldstændig blind.
//
// Vinduet placeres uden for skærmen, så det ikke ligger i vejen. På en
// Linux-server skal processen i stedet pakkes i "xvfb-run".
const OFFSCREEN = "--window-position=-32000,-32000";

export async function openBrowser({ profileDir, visible = false }) {
    const context = await chromium.launchPersistentContext(profileDir, {
        headless: false,
        // Rigtig Chrome frem for den medfølgende Chromium: det er den kombination
        // der er afprøvet mod Proshop.
        channel: process.env.CHROME_CHANNEL || "chrome",
        locale: "da-DK",
        timezoneId: "Europe/Copenhagen",
        viewport: { width: 1440, height: 900 },
        args: ["--disable-blink-features=AutomationControlled", ...(visible ? [] : [OFFSCREEN])],
    });

    const page = context.pages()[0] ?? await context.newPage();
    return { context, page };
}

const CHALLENGE_TITLE = /øjeblik|just a moment|verifying|attention required/i;

// Profilen er vedvarende, så cookien fra sidste kørsel gør at de fleste
// sidevisninger slipper direkte igennem. Bliver vi alligevel udfordret, løser
// siden det selv — vi skal bare vente på at titlen skifter.
export async function loadPage(page, url, { timeoutMs = 45000 } = {}) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });

    const deadline = Date.now() + timeoutMs;
    while (CHALLENGE_TITLE.test(await page.title())) {
        if (Date.now() > deadline) {
            throw new Error(`Kom ikke forbi bot-beskyttelsen på ${url}`);
        }
        await page.waitForTimeout(1500);
    }
}

export const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

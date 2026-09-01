import test from "node:test";
import assert from "node:assert/strict";
import { missingPermissions } from "../src/commands.js";

const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const EMBED_LINKS = 1n << 14n;
const ALL = (VIEW_CHANNEL | SEND_MESSAGES | EMBED_LINKS).toString();

test("intet mangler når botten har alle tre rettigheder", () => {
    assert.deepEqual(missingPermissions(ALL), []);
});

test("administrator dækker alt", () => {
    assert.deepEqual(missingPermissions((1n << 3n).toString()), []);
});

test("hver manglende rettighed nævnes ved navn", () => {
    assert.deepEqual(
        missingPermissions((VIEW_CHANNEL | SEND_MESSAGES).toString()),
        ["Indlejr links"]
    );
    assert.deepEqual(
        missingPermissions(VIEW_CHANNEL.toString()),
        ["Send beskeder", "Indlejr links"]
    );
});

test("en interaktion uden app_permissions behandles som ingen rettigheder", () => {
    assert.equal(missingPermissions(undefined).length, 3);
    assert.equal(missingPermissions("0").length, 3);
});

// Discords rettighedsfelt er større end Number kan rumme præcist, så det
// kommer som tekst og skal regnes i BigInt.
test("store rettighedsfelter mister ikke de lave bits", () => {
    const withAdminAndMore = ((1n << 50n) | VIEW_CHANNEL | SEND_MESSAGES).toString();
    assert.deepEqual(missingPermissions(withAdminAndMore), ["Indlejr links"]);
});

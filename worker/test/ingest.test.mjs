import test from "node:test";
import assert from "node:assert/strict";
import { canPrune, matchesWatch } from "../src/ingest.js";

const product = (overrides = {}) => ({
    productId: "3196393",
    name: "Pokemon TCG Elite Trainer Box Chaos Rising",
    price: 300,
    inStock: true,
    ...overrides,
});

const watch = (overrides = {}) => ({
    shop: "proshop",
    keywords: [],
    events: ["new", "restock", "price_drop"],
    maxPrice: null,
    minDropPct: null,
    ...overrides,
});

test("en overvågning uden søgeord tager alle varer", () => {
    assert.equal(matchesWatch(watch(), { type: "new", product: product() }), true);
});

test("hændelsestyper uden for overvågningen slipper ikke igennem", () => {
    const onlyRestock = watch({ events: ["restock"] });
    assert.equal(matchesWatch(onlyRestock, { type: "new", product: product() }), false);
    assert.equal(matchesWatch(onlyRestock, { type: "restock", product: product() }), true);
});

test("alle søgeord skal findes i navnet, uanset rækkefølge", () => {
    const box = watch({ keywords: ["elite", "trainer", "box"] });
    assert.equal(matchesWatch(box, { type: "new", product: product() }), true);
    assert.equal(
        matchesWatch(box, { type: "new", product: product({ name: "Pokemon Elite Box" }) }),
        false
    );
});

test("maxPrice holder både dyre varer og varer uden pris ude", () => {
    const cheap = watch({ maxPrice: 250 });
    assert.equal(matchesWatch(cheap, { type: "new", product: product({ price: 200 }) }), true);
    assert.equal(matchesWatch(cheap, { type: "new", product: product({ price: 300 }) }), false);
    assert.equal(matchesWatch(cheap, { type: "new", product: product({ price: null }) }), false);
});

test("prisfald under grænsen bliver ikke meldt", () => {
    const w = watch({ minDropPct: 20 });
    const drop = (from, to) => ({ type: "price_drop", product: product({ price: to }), previous: { price: from } });
    assert.equal(matchesWatch(w, drop(100, 75)), true);
    assert.equal(matchesWatch(w, drop(100, 95)), false);
});

test("prisfald bruger 5 procent når overvågningen ikke siger andet", () => {
    const w = watch();
    const drop = (from, to) => ({ type: "price_drop", product: product({ price: to }), previous: { price: from } });
    assert.equal(matchesWatch(w, drop(100, 90)), true);
    assert.equal(matchesWatch(w, drop(100, 99)), false);
});

const snapshot = (overrides = {}) => ({ complete: true, incomingCount: 20, flooded: false, ...overrides });

test("et komplet snapshot rydder de varer op der ikke er med", () => {
    assert.equal(canPrune(snapshot()), true);
});

test("et delvist snapshot rydder ikke op", () => {
    assert.equal(canPrune(snapshot({ complete: false })), false);
});

test("et tomt snapshot tømmer ikke butikken", () => {
    assert.equal(canPrune(snapshot({ incomingCount: 0 })), false);
});

test("nye varenumre holder oprydningen tilbage sammen med alarmerne", () => {
    assert.equal(canPrune(snapshot({ flooded: true })), false);
});

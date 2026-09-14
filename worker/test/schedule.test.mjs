import test from "node:test";
import assert from "node:assert/strict";
import { scrapePlan } from "../src/index.js";

const at = iso => ({ scheduledTime: new Date(iso).getTime() });
const env = { FAST_SHOP: "mugglealley" };

test("på kvartererne scrapes alle butikker", () => {
    for (const minute of ["00", "15", "30", "45"]) {
        assert.deepEqual(scrapePlan(at(`2026-09-14T08:${minute}:00Z`), env), { shop: "" });
    }
});

test("imellem kvartererne scrapes kun den hurtige butik", () => {
    assert.deepEqual(scrapePlan(at("2026-09-14T08:05:00Z"), env), { shop: "mugglealley" });
    assert.deepEqual(scrapePlan(at("2026-09-14T08:40:00Z"), env), { shop: "mugglealley" });
});

test("uden FAST_SHOP springes de ekstra kørsler over", () => {
    assert.equal(scrapePlan(at("2026-09-14T08:05:00Z"), {}), null);
    assert.equal(scrapePlan(at("2026-09-14T08:05:00Z"), { FAST_SHOP: "" }), null);
    assert.deepEqual(scrapePlan(at("2026-09-14T08:00:00Z"), {}), { shop: "" });
});

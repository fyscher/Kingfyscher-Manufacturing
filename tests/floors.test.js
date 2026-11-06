const { test, describe, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const supertest = require("supertest");

const { openDb, setCheckpoint } = require("../indexer/db");
const { computeFloors, applyListingDeltas, enrichListings, lookupUnmapped } = require("../indexer/floors");
const { toRawDelta } = require("../indexer/decode");
const { insertRawDeltas } = require("../indexer/db");

// Each test file gets its own databases: node --test runs files in parallel.
const tmp = name => path.join(os.tmpdir(), `kfm-floors-${process.pid}-${name}.db`);
const INDEXER_FILE = tmp("indexer");
process.env.INDEXER_DB_PATH = INDEXER_FILE;
process.env.DB_PATH = tmp("users");
after(() => {
  for (const f of [INDEXER_FILE, tmp("users")]) for (const s of ["", "-wal", "-shm"]) fs.rmSync(f + s, { force: true });
});

function seed(db) {
  const prop = db.prepare(`INSERT INTO properties (id, address, city_id, city_name, neighborhood_id, neighborhood_name, mint_price, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'For sale', '2026-11-01T00:00:00.000Z')`);
  const list = db.prepare(`INSERT INTO listings_current (property_id, seller, price_upx, price_fiat, flags, snapshot_at)
    VALUES (?, 'seller', ?, ?, '000', '2026-11-01T00:00:00.000Z')`);
  // Santa Clara: asks 900, 1000, 1200, 5000 (+ one USD-only); Manhattan: 3000, 4000.
  [["1", "1 A ST", 12, "Santa Clara", 943, "SOUTHWEST", 1000, 900, 0],
   ["2", "2 B ST", 12, "Santa Clara", 943, "SOUTHWEST", 500, 1000, 0],
   ["3", "3 C ST", 12, "Santa Clara", 944, "NORTH", 2000, 1200, 0],
   ["4", "4 D ST", 12, "Santa Clara", 944, "NORTH", 2500, 5000, 0],
   ["5", "5 E ST", 12, "Santa Clara", 944, "NORTH", 3000, 0, 4.5],
   ["6", "6 PARK AVE", 3, "Manhattan", 10, "MIDTOWN", 6000, 3000, 0],
   ["7", "7 PARK AVE", 3, "Manhattan", 10, "MIDTOWN", 1000, 4000, 0]].forEach(([id, addr, cid, cname, nid, nname, mint, upx, usd]) => {
    prop.run(id, addr, cid, cname, nid, nname, mint);
    list.run(id, upx, usd);
  });
  list.run("999", 50, 0); // a listing whose property isn't catalogued yet
  enrichListings(db);
  setCheckpoint(db, "snapshot:listings", "2026-11-01T00:00:00.000Z");
}

describe("floors", () => {
  test("per-city floor, sturdier floor, median, markup and USD floor", () => {
    const db = openDb(":memory:");
    seed(db);
    const r = computeFloors(db, { top: 3 });
    assert.deepStrictEqual(r.cities.map(c => c.cityName), ["Santa Clara", "Manhattan"], "cheapest floor first");
    const sc = r.cities[0];
    assert.strictEqual(sc.floor.priceUpx, 900);
    assert.strictEqual(sc.robustFloor, 1200, "3rd cheapest");
    assert.strictEqual(sc.medianAsk, 1100);
    assert.deepStrictEqual([sc.upxListings, sc.usdListings], [4, 1]);
    assert.strictEqual(sc.lowestMarkup.address, "3 C ST", "1200 on a 2000 mint is x0.6");
    assert.strictEqual(sc.lowestMarkup.markup, 0.6);
    assert.strictEqual(sc.usdFloor.priceUsd, 4.5);
    assert.deepStrictEqual(r.cheapest.map(l => l.priceUpx), [900, 1000, 1200], "cheapest across all of Upland");
    assert.deepStrictEqual([r.listings, r.unmappedListings], [8, 1]);
  });

  test("filters to the chosen cities", () => {
    const db = openDb(":memory:");
    seed(db);
    const r = computeFloors(db, { cityIds: [3], top: 10 });
    assert.deepStrictEqual(r.cities.map(c => c.cityName), ["Manhattan"]);
    assert.deepStrictEqual(r.cheapest.map(l => l.priceUpx), [3000, 4000]);
  });

  test("table changes keep the listing book current, removals first within a block", () => {
    const db = openDb(":memory:");
    seed(db);
    setCheckpoint(db, "listings:applied", "2026-11-01T00:00:00.000Z");
    const delta = (block, present, a34, f4) => toRawDelta("t2", {
      block_num: block, timestamp: "2026-11-01T00:05:00.000", code: "playuplandme", scope: "playuplandme", table: "t2",
      primary_key: a34, present, data: { a34, a35: "someone", f4: `${f4}.00 UPX`, f3: "0.00 FIAT", f21: false, f22: true, f23: false },
    });
    insertRawDeltas(db, [
      delta(100, 0, "1", 900), // the 900 floor sold
      delta(101, 1, "2", 800), // repriced 1000 -> 800
      delta(102, 1, "7", 3500), // sold and relisted in the same block...
      delta(102, 0, "7", 4000), // ...stored in the other order on purpose
    ]);
    assert.strictEqual(applyListingDeltas(db), 4);
    const r = computeFloors(db, { cityIds: [12, 3] });
    assert.strictEqual(r.cities.find(c => c.cityName === "Santa Clara").floor.priceUpx, 800);
    const manhattan = r.cheapest.filter(l => l.city === "Manhattan").map(l => l.priceUpx);
    assert.deepStrictEqual(manhattan, [3000, 3500], "the relist survives");
    assert.strictEqual(applyListingDeltas(db), 4, "replaying is idempotent from the last applied time");
  });
});

describe("unmapped lookups", () => {
  test("places listings the city paging missed and remembers the ones the API can't", async () => {
    const db = openDb(":memory:");
    seed(db); // listing 999 has no catalogued property
    db.prepare("INSERT INTO listings_current (property_id, seller, price_upx, price_fiat, flags, snapshot_at) VALUES ('998', 's', 70, 0, '000', 'x')").run();
    const asked = [];
    const client = {
      getJson: async url => {
        asked.push(url);
        if (url.endsWith("/999")) {
          return { id: 999, address: "70 ARROYO AVE", city: { id: 7, name: "Oakland" }, neighborhood: { id: 5, name: "PIEDMONT" }, mintPrice: 8800 };
        }
        throw Object.assign(new Error("Upland chain API 404"), { status: 404 }); // what the real API does for unknown ids
      },
    };
    const r = await lookupUnmapped({ db, client, apiUrl: "https://api", basicAuth: "x" });
    assert.deepStrictEqual(r, { found: 1, unknown: 1 });
    const placed = db.prepare("SELECT city_name, neighborhood_name, mint_price FROM listings_current WHERE property_id = '999'").get();
    assert.deepStrictEqual(placed, { city_name: "Oakland", neighborhood_name: "PIEDMONT", mint_price: 8800 });
    await lookupUnmapped({ db, client, apiUrl: "https://api", basicAuth: "x" });
    assert.strictEqual(asked.length, 2, "neither is asked about twice");
  });
});

describe("GET /api/upland/floors", () => {
  test("serves floors from the indexer database", async () => {
    const db = openDb(INDEXER_FILE);
    seed(db);
    db.close();
    const api = supertest(require("../app"));
    const all = await api.get("/api/upland/floors?top=2").expect(200);
    assert.deepStrictEqual(all.body.cheapest.map(l => l.priceUpx), [900, 1000]);
    const picked = await api.get("/api/upland/floors?cities=3").expect(200);
    assert.deepStrictEqual(picked.body.cities.map(c => c.cityName), ["Manhattan"]);
    const except = await api.get("/api/upland/floors?exclude=12&top=5").expect(200);
    assert.deepStrictEqual(except.body.cities.map(c => c.cityName), ["Manhattan"], "all of Upland except Santa Clara");
    assert.deepStrictEqual(except.body.cheapest.map(l => l.priceUpx), [3000, 4000], "and its cheapest list leaves Santa Clara out");
    const both = await api.get("/api/upland/floors?cities=12&exclude=12").expect(200);
    assert.deepStrictEqual(both.body.cities.map(c => c.cityName), ["Santa Clara"], "a pick list wins over an exclude list");
    const cities = await api.get("/api/upland/floors/cities").expect(200);
    assert.deepStrictEqual(cities.body.cities.map(c => [c.name, c.listings]), [["Manhattan", 2], ["Santa Clara", 5]]);
  });
});

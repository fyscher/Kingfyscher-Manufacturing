const { test, describe, after, before } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const supertest = require("supertest");

const { openDb, setCheckpoint, getCheckpoint, insertRawDeltas } = require("../indexer/db");
const { toRawDelta } = require("../indexer/decode");
const { snapshotBuildings, applyBuildingDeltas, snapshotConstructions, applyConstructionDeltas, refreshBuildingTypes, buildingName } = require("../indexer/buildings");
const { tail } = require("../indexer/sync");

// Each test file gets its own databases: node --test runs files in parallel.
const tmp = name => path.join(os.tmpdir(), `kfm-buildings-${process.pid}-${name}.db`);
const INDEXER_FILE = tmp("indexer");
process.env.INDEXER_DB_PATH = INDEXER_FILE;
process.env.DB_PATH = tmp("users");
after(() => {
  for (const f of [INDEXER_FILE, tmp("users")]) for (const s of ["", "-wal", "-shm"]) fs.rmSync(f + s, { force: true });
});

const a21 = (nft, property, f54 = 1) => ({ f45: nft, a34: String(property), f54, f55: 0 });
const delta = (block, ts, present, row) => toRawDelta("a21", {
  block_num: block, timestamp: ts, code: "playuplandme", scope: "playuplandme", table: "a21",
  primary_key: String(row.f45), present: present ? 1 : 0, data: row,
});

describe("BUILD payments", () => {
  test("a construction's BUILD memo names the building and the property", () => {
    const { decodeBuilds } = require("../indexer/decode");
    const raw = (memo, from = "builder") => ({ ts: "2025-11-11T00:00:00.000Z", data: { from, to: "playuplandme", memo } });
    assert.deepStrictEqual(decodeBuilds([
      raw("BUILD,6773067,76375443079320,42,0,6300000,19000,3900000,str"),
      raw("STAKE,123"),
      raw("BUILD,garbage"),
    ]), [{ nft_id: 6773067, property_id: "76375443079320", city_id: 42, ts: "2025-11-11T00:00:00.000Z", account: "builder" }]);
  });
});

describe("building names", () => {
  test("the chain's descriptions become names (real examples, 2026-11-03)", () => {
    assert.deepStrictEqual([
      buildingName("test", "smltownhouse"),
      buildingName("Small Town House", "smltwnhouse2"),
      buildingName("This structure represents a tiny house residential model within the Upland Metaverse", "iwzpfunivool"),
      buildingName("This model represents a limited time Miami Town House 1 with fixed colors", "zpkdfghreizx"),
      buildingName("This model represnts a Wonderland structure - Cosy Cabin", "xfgrlmpoycta"),
      buildingName("This model is an NFT replica of a small generic manufacturing factory and is part of a series", "nwggacogbxyt"),
      buildingName("PhoenixTat's Chic Hollywood Hills is a winning entry from the 2022 Master Builders Contest", "yycyygyostby"),
      buildingName("Master Builders 2023 model winner - Brownstone Queens (UGC Queens Winner)", "ofcnbgrpeqtn"),
      buildingName("", "mystery"),
    ], [
      "Small Town House (original)", "Small Town House", "Tiny House", "Miami Town House 1", "Wonderland Structure - Cosy Cabin",
      "Small Generic Manufacturing Factory", "Chic Hollywood Hills (by PhoenixTat, Master Builders 2022)",
      "Brownstone Queens (UGC Queens Winner) (Master Builders 2023)", "mystery",
    ]);
  });
});

describe("buildings indexer", () => {
  test("a snapshot pages the whole table, then changes replay in block order", async () => {
    const db = openDb(":memory:");
    const table = [a21(10, 111), a21(11, 222), a21(12, 333)];
    let calls = 0;
    const client = {
      requestCount: 0,
      getTableRows: async body => {
        calls++;
        const from = Number(body.lower_bound || 0);
        const page = table.filter(r => r.f45 >= from).slice(0, 2);
        const rest = table.filter(r => r.f45 >= from).slice(2);
        return { rows: page, more: rest.length > 0, next_key: rest.length ? String(rest[0].f45) : "" };
      },
    };
    assert.strictEqual(await snapshotBuildings({ db, client }), 3);
    assert.strictEqual(calls, 2);
    const started = getCheckpoint(db, "buildings:applied");
    const later = new Date(Date.parse(started) + 60_000).toISOString().replace("Z", "");
    insertRawDeltas(db, [
      delta(500, later, 0, a21(11, 222)), // demolished...
      delta(500, later, 1, a21(13, 222, 5)), // ...and a new one started in the same block
      delta(501, later, 1, a21(14, 444)),
    ]);
    assert.strictEqual(applyBuildingDeltas(db), 3);
    assert.deepStrictEqual(db.prepare("SELECT nft_id, property_id, f54 FROM property_buildings ORDER BY nft_id").all().map(r => [r.nft_id, r.property_id, r.f54]),
      [[10, "111", 1], [12, "333", 1], [13, "222", 5], [14, "444", 1]]);
  });

  test("each building carries its type and city: right away when known, else on the next refresh", () => {
    const db = openDb(":memory:");
    setCheckpoint(db, "buildings:applied", "2026-11-03T20:00:00.000Z");
    db.prepare("INSERT INTO nft_items (id, category, token_name, serial, in_escrow) VALUES (20, 'structure', 'townhouse', 1, 0)").run();
    db.prepare("INSERT INTO properties (id, address, city_id, city_name, updated_at) VALUES ('900', '9 Z ST', 12, 'Santa Clara', 'x')").run();
    insertRawDeltas(db, [
      delta(600, "2026-11-03T20:01:00.000", 1, a21(20, 900)), // both known
      delta(601, "2026-11-03T20:02:00.000", 1, a21(21, 901)), // NFT and property not read yet
    ]);
    applyBuildingDeltas(db);
    const rows = () => db.prepare("SELECT nft_id, token_name, city_id FROM property_buildings ORDER BY nft_id").all().map(r => [r.nft_id, r.token_name, r.city_id]);
    assert.deepStrictEqual(rows(), [[20, "townhouse", 12], [21, null, null]]);
    db.prepare("INSERT INTO nft_items (id, category, token_name, serial, in_escrow) VALUES (21, 'structure', 'ranchhouse', 1, 0)").run();
    db.prepare("INSERT INTO properties (id, address, city_id, city_name, updated_at) VALUES ('901', '1 Y ST', 3, 'Manhattan', 'x')").run();
    refreshBuildingTypes(db);
    assert.deepStrictEqual(rows(), [[20, "townhouse", 12], [21, "ranchhouse", 3]]);
    assert.strictEqual(getCheckpoint(db, "buildings:unidentified"), "0");
  });

  test("a building counts as finished once its construction record leaves", async () => {
    const db = openDb(":memory:");
    const client = { requestCount: 0, getTableRows: async () => ({ rows: [{ f45: 30, f51: "2026-10-19T08:35:07.500", f52: "2026-12-23T16:17:06.068", f53: "0.0", f123: "11700000.0" }], more: false }) };
    assert.strictEqual(await snapshotConstructions({ db, client }), 1);
    db.prepare("INSERT INTO property_buildings (nft_id, property_id, updated_at) VALUES (30, '500', 'x')").run();
    refreshBuildingTypes(db);
    const flag = () => db.prepare("SELECT under_construction, on_property FROM property_buildings WHERE nft_id = 30").get();
    assert.deepStrictEqual(flag(), { under_construction: 1, on_property: 0 });
    const later = new Date(Date.parse(getCheckpoint(db, "constructions:applied")) + 60_000).toISOString().replace("Z", "");
    insertRawDeltas(db, [toRawDelta("a23", { block_num: 700, timestamp: later, code: "playuplandme", scope: "playuplandme", table: "a23", primary_key: "30", present: 0, data: { f45: 30 } })]);
    applyConstructionDeltas(db);
    refreshBuildingTypes(db);
    assert.deepStrictEqual(flag(), { under_construction: 0, on_property: 1 });
  });

  test("the tail fetches building changes from the buildings mark", async () => {
    const db = openDb(":memory:");
    setCheckpoint(db, "buildings:applied", "2026-11-03T20:00:00.000Z");
    const asked = [];
    const client = { requestCount: 0, getActions: async () => ({ actions: [] }), getDeltas: async p => { asked.push(p); return { deltas: [] }; }, getTableRows: async () => ({ rows: [] }) };
    let cycles = 0;
    await tail({ db, client, feeds: ["a21"], intervalMs: 0, lagMs: 60_000, now: () => Date.parse("2026-11-03T21:00:00.000Z"),
      sleep: async () => {}, shouldStop: () => cycles++ > 0 });
    assert.deepStrictEqual([asked[0].table, asked[0].after], ["a21", "2026-11-03T20:00:00.000Z"]);
  });
});

describe("GET /api/upland/structures/building-*", () => {
  before(() => {
    const db = openDb(INDEXER_FILE);
    const design = db.prepare("INSERT INTO designs (category, token_name, category_name_id, updated_at) VALUES ('structure', ?, ?, 'x')");
    const name = db.prepare("INSERT INTO design_names (category_name_id, display_name, updated_at) VALUES (?, ?, 'x')");
    design.run("smltownhouse", "1"); name.run("1", "Small Town House");
    design.run("ranchhouse", "2"); name.run("2", "Ranch House");
    const prop = db.prepare(`INSERT INTO properties (id, address, city_id, city_name, neighborhood_name, mint_price, updated_at)
      VALUES (?, ?, ?, ?, 'SOMA', ?, 'x')`);
    const item = db.prepare("INSERT INTO nft_items (id, category, token_name, serial, in_escrow) VALUES (?, 'structure', ?, 1, 0)");
    const placed = db.prepare("INSERT INTO property_buildings (nft_id, property_id, f54, f55, updated_at) VALUES (?, ?, 1, 0, 'x')");
    const listed = db.prepare("INSERT INTO listings_current (property_id, seller, price_upx, price_fiat, flags, snapshot_at) VALUES (?, 's', ?, ?, '000', 'x')");
    // San Francisco (1): three small town houses, two for sale; one ranch house. Manhattan (3): one small town house for sale.
    [["101", "1 A ST", 1, "San Francisco", 5000, 1, "smltownhouse", 9000, 0],
     ["102", "2 B ST", 1, "San Francisco", 6000, 2, "smltownhouse", 7000, 0],
     ["103", "3 C ST", 1, "San Francisco", 7000, 3, "smltownhouse", null, null],
     ["104", "4 D ST", 1, "San Francisco", 8000, 4, "ranchhouse", null, null],
     ["301", "9 PARK AVE", 3, "Manhattan", 9000, 5, "smltownhouse", 0, 25]].forEach(([id, addr, city, cname, mint, nft, type, upx, usd]) => {
      prop.run(id, addr, city, cname, mint);
      item.run(nft, type);
      placed.run(nft, id);
      if (upx !== null) listed.run(id, upx, usd);
    });
    placed.run(6, "105"); // a building whose NFT hasn't been read yet
    // A parcel in San Francisco with two buildings, listed cheaper than any single house.
    prop.run("106", "6 PARCEL WAY", 1, "San Francisco", 9000);
    item.run(7, "smltownhouse"); placed.run(7, "106");
    item.run(8, "ranchhouse"); placed.run(8, "106");
    listed.run("106", 5000, 0);
    // A house still under construction, listed cheaper than any finished one.
    prop.run("107", "7 SCAFFOLD ST", 1, "San Francisco", 4000);
    item.run(9, "smltownhouse"); placed.run(9, "107");
    listed.run("107", 6000, 0);
    db.prepare("INSERT INTO constructions (nft_id, started_at, eta, progress, needed, updated_at) VALUES (9, '2026-10-19T08:35:07.500Z', '2026-12-23T16:17:06.068Z', 0, 11700000, 'x')").run();
    // 1 A ST's house went up on Oct 5 (its BUILD payment), after its Oct 1 sale.
    db.prepare("INSERT INTO building_builds (nft_id, property_id, city_id, ts, account) VALUES (1, '101', 1, '2026-10-05T00:00:00.000Z', 'builder')").run();
    const sale = db.prepare(`INSERT INTO property_sales (global_sequence, trx_id, ts, block_num, kind, property_id, price, currency)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?)`);
    sale.run("1", "t1", "2026-10-01T00:00:00.000Z", "upx", "101", 8000, "UPX");
    sale.run("2", "t2", "2026-10-20T00:00:00.000Z", "upx", "301", 12000, "UPX"); // Manhattan: sales count across cities
    sale.run("3", "t3", "2026-10-25T00:00:00.000Z", "upx", "102", 1, "UPX"); // a 1-UPX transfer between own accounts
    sale.run("4", "t4", "2026-10-28T00:00:00.000Z", "usd", "103", 40, "FIAT");
    sale.run("5", "t5", "2026-10-30T00:00:00.000Z", "upx", "104", 15000, "UPX"); // a ranch house: another building
    sale.run("6", "t6", "2026-10-29T00:00:00.000Z", "upx", "106", 50000, "UPX"); // the parcel
    sale.run("7", "t7", "2026-10-31T00:00:00.000Z", "upx", "107", 9000, "UPX"); // the unfinished house
    setCheckpoint(db, "snapshot:buildings", "2026-11-03T20:00:00.000Z");
    setCheckpoint(db, "buildings:applied", "2026-11-03T20:00:00.000Z");
    refreshBuildingTypes(db);
    db.close();
  });

  test("the dropdown: buildings, properties for sale, and the cheapest property with just that building", async () => {
    const api = supertest(require("../app"));
    const all = await api.get("/api/upland/structures/building-types").expect(200);
    assert.deepStrictEqual(all.body.types.map(t => [t.name, t.buildings, t.underConstruction, t.properties, t.forSale, t.cheapestUpx]),
      [["Ranch House", 2, 0, 2, 1, null], ["Small Town House (original)", 5, 1, 5, 4, 7000]],
      "the parcel at 5,000 counts as for sale but isn't the cheapest house; the unfinished one at 6,000 counts for neither; a USD-only listing has no UPX ask");
    assert.strictEqual(all.body.unidentified, 1);
    const sf = await api.get("/api/upland/structures/building-types?cityId=1").expect(200);
    assert.deepStrictEqual(sf.body.types.map(t => [t.type, t.buildings, t.forSale]), [["ranchhouse", 2, 1], ["smltownhouse", 4, 3]]);
  });

  test("one building: properties, for sale first and cheapest first", async () => {
    const api = supertest(require("../app"));
    const r = await api.get("/api/upland/structures/buildings?type=smltownhouse&cityId=1").expect(200);
    assert.deepStrictEqual(r.body.properties.map(p => [p.address, p.priceUpx, p.buildingsOnProperty]),
      [["6 PARCEL WAY", 5000, 2], ["2 B ST", 7000, 1], ["1 A ST", 9000, 1], ["3 C ST", null, 1]]);
    assert.strictEqual(r.body.total, 4);
    const single = await api.get("/api/upland/structures/buildings?type=smltownhouse&cityId=1&single=1").expect(200);
    assert.deepStrictEqual(single.body.properties.map(p => p.address), ["2 B ST", "1 A ST", "3 C ST"], "the parcel left out");
    assert.strictEqual(single.body.total, 3);
    const forSale = await api.get("/api/upland/structures/buildings?type=smltownhouse&forSale=1&single=1").expect(200);
    assert.deepStrictEqual(forSale.body.properties.map(p => [p.address, p.priceUpx, p.priceUsd]),
      [["2 B ST", 7000, 0], ["1 A ST", 9000, 0], ["9 PARK AVE", 0, 25]], "UPX asks first, then USD-only");
    assert.strictEqual(forSale.body.total, 3, "the total counts what's for sale everywhere");
    const withUnfinished = await api.get("/api/upland/structures/buildings?type=smltownhouse&cityId=1&forSale=1&single=1&unfinished=1").expect(200);
    assert.deepStrictEqual(withUnfinished.body.properties.map(p => [p.address, p.underConstruction, p.finishesAround]),
      [["7 SCAFFOLD ST", 1, "2026-12-23T16:17:06.068Z"], ["2 B ST", 0, null], ["1 A ST", 0, null]], "shown on request, flagged with its finish");
    await api.get("/api/upland/structures/buildings").expect(400);
  });

  test("a building's latest sales: only its own price, after it was built, across every city", async () => {
    const api = supertest(require("../app"));
    const r = await api.get("/api/upland/structures/building-sales?type=smltownhouse").expect(200);
    assert.deepStrictEqual(r.body.sales.map(s => [s.address, s.city, s.kind, s.price]),
      [["3 C ST", "San Francisco", "usd", 40], ["9 PARK AVE", "Manhattan", "upx", 12000]],
      "left out: the parcel's 50,000, the Oct 1 sale before the house went up, the 1-UPX transfer, the ranch house's sale");
    assert.deepStrictEqual(r.body.leftOut, { parcels: 1, beforeBuilt: 1, unfinished: 1 });
    assert.deepStrictEqual(r.body.listedNow, { forSale: 4, cheapestUpx: 7000 });
    assert.strictEqual(r.body.salesSince, "2026-10-01T00:00:00.000Z");
    assert.strictEqual((await api.get("/api/upland/structures/building-sales?type=smltownhouse&limit=1").expect(200)).body.sales.length, 1);
    await api.get("/api/upland/structures/building-sales").expect(400);
  });
});

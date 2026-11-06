const { test, describe, after, before } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const supertest = require("supertest");

const { openDb, setCheckpoint } = require("../indexer/db");
const { refreshMarket } = require("../indexer/nfts");

// Each test file gets its own databases: node --test runs files in parallel.
const tmp = name => path.join(os.tmpdir(), `kfm-market-${process.pid}-${name}.db`);
const INDEXER_FILE = tmp("indexer");
process.env.INDEXER_DB_PATH = INDEXER_FILE;
process.env.DB_PATH = tmp("users");
after(() => {
  for (const f of [INDEXER_FILE, tmp("users")]) for (const s of ["", "-wal", "-shm"]) fs.rmSync(f + s, { force: true });
});

const DAY = 86_400_000;
const ago = days => new Date(Date.now() - days * DAY).toISOString();

before(() => {
  const db = openDb(INDEXER_FILE);
  const design = db.prepare(`INSERT INTO designs (category, token_name, category_name_id, max_supply, issued_supply, current_supply, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'x')`);
  const name = db.prepare("INSERT INTO design_names (category_name_id, display_name, updated_at) VALUES (?, ?, 'x')");
  [["outdoordecor", "bench", "1", "Park Bench", 100, 50], ["outdoordecor", "lamp", "2", "Street Lamp 100%", 20, 20],
   ["seeds", "rose", "3", "Red Rose", 9000, 8000]].forEach(([c, t, id, n, max, issued]) => {
    design.run(c, t, id, max, issued, issued);
    name.run(id, n);
  });
  const item = db.prepare("INSERT INTO nft_items (id, category, token_name, serial, in_escrow) VALUES (?, ?, ?, ?, ?)");
  item.run(1, "outdoordecor", "bench", 1, 1); // listed by alice 2 days ago
  item.run(2, "outdoordecor", "bench", 2, 1); // listed by bob 5 days ago
  item.run(3, "outdoordecor", "bench", 3, 1); // listed, delisted, then escrowed some other way
  item.run(4, "outdoordecor", "bench", 4, 1); // in escrow since before our history
  item.run(5, "outdoordecor", "bench", 5, 0);
  item.run(6, "outdoordecor", "lamp", 1, 0);
  item.run(7, "seeds", "rose", 10, 1);
  const ev = db.prepare(`INSERT INTO nft_escrow_events (id, global_sequence, ts, block_num, dgood_id, direction, account, kind)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  ev.run("e1", "101", ago(2), 101, 1, "in", "alice", "listing");
  ev.run("e2", "102", ago(5), 50, 2, "in", "bob", "listing");
  ev.run("e3", "103", ago(9), 10, 3, "in", "carol", "listing");
  ev.run("e4", "104", ago(8), 20, 3, "out", "carol", "delist");
  ev.run("e5", "105", ago(7), 30, 3, "in", "carol", "other");
  ev.run("e6", "106", ago(1), 120, 7, "in", "dave", "listing");
  // Placed on a property its owner listed in the same block: comes with the property, not for sale alone.
  item.run(8, "outdoordecor", "bench", 6, 1);
  db.prepare(`INSERT INTO nft_escrow_events (id, global_sequence, ts, block_num, dgood_id, direction, account, kind, property_id)
    VALUES ('e7', '107', ?, 130, 8, 'in', 'erin', 'bundle', '131000000001')`).run(ago(1));
  const prop = db.prepare(`INSERT INTO properties (id, address, city_id, city_name, neighborhood_id, neighborhood_name, mint_price, status, updated_at)
    VALUES (?, ?, 1, 'San Francisco', 5, 'Mission', ?, 'For sale', 'x')`);
  prop.run("131000000001", "131 FRANKLIN ST", 8000);
  prop.run("131000000002", "1310 FRANKLIN ST", 9000);
  prop.run("200000000003", "20 MAIN ST", 7000);
  db.prepare("INSERT INTO listings_current (property_id, price_upx, price_fiat, snapshot_at) VALUES ('131000000001', 25000, 0, 'x')").run();
  db.prepare(`INSERT INTO building_values (token_name, name, sales, median, p25, p75, pairs, hours_needed, min_stake, max_stake, builds_90d, contracts_90d, refreshed_at)
    VALUES ('tiny', 'Tiny House', 40, 2000, -500, 6000, 3, 1500000, 50, 72000, 900, 4, 'x'), ('old', 'Old Shed', 2, 900, 800, 1000, 0, NULL, NULL, NULL, 0, 0, 'x')`).run();
  db.prepare("INSERT INTO appraisal_stats (key, value, refreshed_at) VALUES ('summary', ?, 'x')")
    .run(JSON.stringify({ backtest: { days: 30, land: { n: 0 }, withBuilding: { n: 0 } }, decor: {}, usd: { upxPerUsd: 6000 } }));
  const sale = db.prepare(`INSERT INTO nft_sales (global_sequence, trx_id, ts, block_num, price, buyer_paid, mint, dgood_id, dg_category, dg_token)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`);
  // Two sales on one UTC day at fixed times (a "now"-relative time flipped their order after 23:00 UTC).
  const day20 = ago(20).slice(0, 10);
  sale.run("s1", "t1", `${day20}T01:00:00.000Z`, 100, 105, 5, "5", "outdoordecor", "bench");
  sale.run("s2", "t2", `${day20}T23:00:00.000Z`, 140, 147, 5, "5", "outdoordecor", "bench");
  sale.run("s3", "t3", ago(3), 120, 126, 5, "5", "outdoordecor", "bench");
  sale.run("s4", "t4", ago(4), 900, 945, 1, "6", "outdoordecor", "lamp");
  sale.run("s5", "t5", ago(2), 2, 2.1, 10, "7", "seeds", "rose");
  setCheckpoint(db, "snapshot:nfts", ago(0.5));
  refreshMarket(db);
  db.close();
});

let token;
const app = () => require("../app");
const get = path => supertest(app()).get(path).set("Authorization", `Bearer ${token}`);
before(async () => {
  const User = require("../models/user");
  const api = supertest(app());
  await User.deleteMany();
  await api.post("/api/users").send({ username: "marketuser", name: "marketuser", password: "testpass1" }).expect(201);
  token = (await api.post("/api/login").send({ username: "marketuser", password: "testpass1" }).expect(200)).body.token;
});

describe("GET /api/upland/market", () => {
  test("needs a signed-in user", async () => {
    await supertest(app()).get("/api/upland/market/summary").expect(401);
  });

  test("summary: categories with their labels and counts", async () => {
    const r = await get("/api/upland/market/summary").expect(200);
    assert.deepStrictEqual(r.body.categories.map(c => [c.label, c.designs, c.listed, c.escrow]),
      [["Outdoor Decor", 2, 2, 5], ["Seeds", 1, 1, 1]], "a property bundle is in escrow but not listed");
    assert.strictEqual(r.body.salesCount, 5);
  });

  test("browse: sort, search, filters and paging", async () => {
    const names = async qs => (await get(`/api/upland/market/assets?${qs}`).expect(200)).body.assets.map(a => a.display_name);
    assert.deepStrictEqual(await names(""), ["Park Bench", "Red Rose", "Street Lamp 100%"], "most listed first");
    assert.deepStrictEqual(await names("sort=cheapest"), ["Red Rose", "Park Bench", "Street Lamp 100%"]);
    assert.deepStrictEqual(await names("category=seeds"), ["Red Rose"]);
    assert.deepStrictEqual(await names("q=street"), ["Street Lamp 100%"], "case-insensitive name search");
    assert.deepStrictEqual(await names("q=%25"), ["Street Lamp 100%"], "a % in the search is literal, not a wildcard");
    assert.deepStrictEqual(await names("listed=1&sort=name"), ["Park Bench", "Red Rose"]);
    assert.deepStrictEqual(await names("minPrice=50&maxPrice=500"), ["Park Bench"], "price = cheapest real 30-day sale");
    const paged = await get("/api/upland/market/assets?pageSize=1&page=2").expect(200);
    assert.deepStrictEqual([paged.body.pageSize, paged.body.total, paged.body.assets.length], [10, 3, 0], "page size is at least 10");
    const bench = (await get("/api/upland/market/assets?q=bench").expect(200)).body.assets[0];
    assert.deepStrictEqual([bench.listed, bench.escrow, bench.sales_30d, bench.median_30d, bench.floor_30d, bench.last_price], [2, 5, 3, 120, 100, 120]);
  });

  test("one design: listings with seller and time, other escrow, sales and daily candles", async () => {
    const r = await get("/api/upland/market/asset/outdoordecor/bench").expect(200);
    assert.deepStrictEqual(r.body.listed.map(i => [i.serial, i.seller]), [[1, "alice"], [2, "bob"]], "newest listing first");
    assert.deepStrictEqual(r.body.otherEscrow.map(i => [i.serial, i.kind, i.address]), [[6, "bundle", "131 FRANKLIN ST"], [3, "other", null], [4, null, null]]);
    assert.deepStrictEqual(r.body.sales.map(s => s.price), [120, 140, 100], "newest first, at the seller's price");
    assert.deepStrictEqual(r.body.candles.map(c => [c.open, c.high, c.low, c.close, c.volume]), [[100, 140, 100, 140, 2], [120, 120, 120, 120, 1]]);
    assert.strictEqual(r.body.design.categoryLabel, "Outdoor Decor");
    assert.deepStrictEqual(r.body.stats[7], { trades: 1, avg: 120, min: 120, max: 120 });
    assert.deepStrictEqual(r.body.stats[30], { trades: 3, avg: 120, min: 100, max: 140 });
    await get("/api/upland/market/asset/outdoordecor/nope").expect(404);
  });
});

describe("GET /api/upland/appraiser", () => {
  test("needs a signed-in user", async () => {
    await supertest(app()).get("/api/upland/appraiser/search?q=131").expect(401);
  });

  test("search: address prefix (any case), or a property id", async () => {
    const ids = async qs => (await get(`/api/upland/appraiser/search?${qs}`).expect(200)).body.results.map(r => r.id);
    assert.deepStrictEqual(await ids("q=131 franklin"), ["131000000001"], "prefix of the address, any case");
    assert.deepStrictEqual(await ids("q=131"), ["131000000001", "131000000002"]);
    assert.deepStrictEqual(await ids("q=200000000003"), ["200000000003"]);
    assert.deepStrictEqual(await ids("q=13"), [], "too short");
    assert.deepStrictEqual(await ids("q=131&cityId=2"), []);
  });

  test("one property: listing bundle and the user's picks priced from resales", async () => {
    const r = await get("/api/upland/appraiser/property/131000000001?picks=outdoordecor/bench*2,bad").expect(200);
    assert.strictEqual(r.body.property.address, "131 FRANKLIN ST");
    assert.strictEqual(r.body.land, null, "no comparable sales here");
    assert.deepStrictEqual(r.body.assets.map(a => [a.name, a.source, a.count, a.value]),
      [["Park Bench", "listing", 1, 120], ["Park Bench", "added by you", 2, 120]]);
    assert.deepStrictEqual(r.body.listing, { upx: 25000, usd: null, usdInUpx: null, asOf: "x" });
    await get("/api/upland/appraiser/property/999").expect(404);
    await get("/api/upland/appraiser/property/abc").expect(400);
  });

  test("build rules: types being built, with their stake limits and what buyers pay", async () => {
    const r = await get("/api/upland/appraiser/build-rules").expect(200);
    assert.deepStrictEqual(r.body.types.map(t => [t.name, t.hoursNeeded, t.minStake, t.maxStake, t.median]), [["Tiny House", 1500000, 50, 72000, 2000]]);
    assert.deepStrictEqual([r.body.types[0].contractN, r.body.types[0].contractMedian], [null, null], "no contract prices yet");
    assert.strictEqual(r.body.stats.usd.upxPerUsd, 6000);
  });
});

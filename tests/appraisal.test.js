const { test, describe } = require("node:test");
const assert = require("node:assert");

const { openDb } = require("../indexer/db");
const { parseBuildMemo, decodeSaleBundles } = require("../indexer/decode");
const { borderingPairs, ringsOf, syncNeighborhoods } = require("../indexer/neighborhoods");
const { weightedQuantile, medianBand, landRatio, landIndex, refreshAppraisal, appraiseProperty } = require("../indexer/appraisal");
const { contractPayout, fetchContractPayouts } = require("../indexer/contracts");

// A square neighborhood, `size` degrees wide, with its lower-left corner at (lon, lat).
const square = (id, lon, lat, size = 0.01) => ({
  id, name: `N${id}`, cityId: 1, area: 1, center: [lon + size / 2, lat + size / 2],
  boundaries: [[[lon, lat], [lon + size, lat], [lon + size, lat + size], [lon, lat + size], [lon, lat]]],
});

describe("neighborhoods", () => {
  test("borders that touch (within 30 m) make neighbors; a gap doesn't", () => {
    const pairs = borderingPairs([
      square(1, -122.40, 37.77),
      square(2, -122.39, 37.77), // shares 1's east edge
      square(3, -122.40, 37.7802), // ~22 m north of 1: touching
      square(4, -122.30, 37.77), // kilometres away
    ]);
    assert.deepStrictEqual(pairs, [[1, 2], [1, 3], [2, 3]]);
  });

  test("polygons, multipolygons and bare rings all read as rings", () => {
    const ring = [[0, 0], [1, 0], [1, 1], [0, 0]];
    assert.strictEqual(ringsOf(ring).length, 1);
    assert.strictEqual(ringsOf([ring]).length, 1);
    assert.strictEqual(ringsOf([[ring], [ring]]).length, 2);
  });

  test("sync stores every neighborhood and both directions of each border", async () => {
    const db = openDb(":memory:");
    const client = {
      requestCount: 0,
      getJson: async url => {
        client.requestCount++;
        if (url.endsWith("/cities")) return { cities: [{ id: 1, name: "San Francisco" }] };
        return { results: [square(1, -122.40, 37.77), square(2, -122.39, 37.77), square(4, -122.30, 37.77)] };
      },
    };
    assert.strictEqual(await syncNeighborhoods({ db, client, apiUrl: "https://x", basicAuth: "y" }), 3);
    assert.deepStrictEqual(db.prepare("SELECT a, b FROM neighborhood_adjacency ORDER BY a").all(), [{ a: 1, b: 2 }, { a: 2, b: 1 }]);
    assert.strictEqual(Math.round(db.prepare("SELECT center_lat FROM neighborhoods WHERE id = 4").get().center_lat * 1000), 37775);
  });
});

describe("chain pieces", () => {
  test("a BUILD memo gives the build's rules, and whether it's a contract", () => {
    assert.deepStrictEqual(
      parseBuildMemo("BUILD,9838936,80394156608149,14,0,41400000,50000,6900000,structure,abdnyfhbdfrs,Qm1,suspended"),
      { nft_id: 9838936, property_id: "80394156608149", hours_needed: 41400000, min_stake: 500, max_stake: 69000, token_name: "abdnyfhbdfrs", contract: true },
    );
    assert.strictEqual(parseBuildMemo("STAKE,1,2"), null);
  });

  test("NFTs escrow hands the buyer inside a property sale's transaction come with the sale", () => {
    const sales = [{ global_sequence: "s1", trx_id: "t1", buyer: "bob" }, { global_sequence: "s2", trx_id: "t2", buyer: "carol" }];
    const transfers = [
      { trx_id: "t1", data: { from: "playuplandme", to: "bob", dgood_ids: ["7", "8"] } },
      { trx_id: "t1", data: { from: "alice", to: "playuplandme", dgood_ids: ["9"] } }, // into escrow: not handed over
      { trx_id: "t3", data: { from: "playuplandme", to: "bob", dgood_ids: ["10"] } }, // another transaction
    ];
    assert.deepStrictEqual(decodeSaleBundles(sales, transfers), [{ sale_seq: "s1", dgood_id: 7 }, { sale_seq: "s1", dgood_id: 8 }]);
  });
});

describe("construction contracts", () => {
  const transfer = (to, quantity) => ({ act: { account: "upxtokenacct", name: "transfer", data: { from: "playuplandme", to, quantity, amount: Number(quantity.split(" ")[0]) } } });
  test("a contract's transaction gives the builder, what they got, and the 5% fee (Live Theater, 2026-11-04)", () => {
    assert.deepStrictEqual(
      contractPayout([{ act: { account: "playuplandme", name: "n151", data: { p113: "9838936" } } }, transfer("builder1", "3572.00 UPX"), transfer("communityupx", "188.00 UPX")]),
      { builder: "builder1", paid: 3572, fee: 188, price: 3760 },
    );
    assert.strictEqual(contractPayout([]).price, null);
  });

  test("each stored contract's transaction is read once, newest first", async () => {
    const db = openDb(":memory:");
    const raw = db.prepare("INSERT INTO raw_actions (global_sequence, feed, trx_id, block_num, ts, contract, name, data) VALUES (?, 'contracts', ?, 1, ?, 'playuplandme', 'n151', ?)");
    raw.run("1", "ta", "2026-11-01T00:00:00.000Z", JSON.stringify({ p113: "11" }));
    raw.run("2", "tb", "2026-11-02T00:00:00.000Z", JSON.stringify({ p113: "12" }));
    const asked = [];
    const client = { requestCount: 0, getTransaction: async id => { asked.push(id); return { actions: id === "tb" ? [transfer("bob", "95.00 UPX"), transfer("communityupx", "5.00 UPX")] : [] }; } };
    assert.strictEqual(await fetchContractPayouts({ db, client, limit: 1 }), 1);
    assert.strictEqual(await fetchContractPayouts({ db, client }), 1);
    assert.strictEqual(await fetchContractPayouts({ db, client }), 0, "nothing is read twice, even with no payout found");
    assert.deepStrictEqual(asked, ["tb", "ta"]);
    assert.deepStrictEqual(db.prepare("SELECT nft_id, builder, price, fee FROM construction_contracts ORDER BY nft_id").all(),
      [{ nft_id: 11, builder: null, price: null, fee: null }, { nft_id: 12, builder: "bob", price: 100, fee: 5 }]);
  });
});

describe("land", () => {
  test("weighted quantiles and the median's 95% band", () => {
    assert.strictEqual(weightedQuantile([{ v: 1, w: 1 }, { v: 2, w: 1 }, { v: 10, w: 3 }], 0.5), 10);
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    assert.deepStrictEqual(medianBand(xs), [41, 61]);
    assert.deepStrictEqual(medianBand([1, 2, 3]), [null, null]);
  });

  test("own and bordering neighborhoods first; wider only when there are too few sales", () => {
    const at = Date.parse("2026-11-03T00:00:00Z");
    const sale = (nbhd, daysAgo, ratio) => ({ neighborhood_id: nbhd, city_id: 1, ts: new Date(at - daysAgo * 86_400_000).toISOString(), price: 1000 * ratio, mint: 1000 });
    const rows = [
      ...Array.from({ length: 8 }, (_, i) => sale(1, i + 1, 1.5)),
      ...Array.from({ length: 8 }, (_, i) => sale(2, i + 1, 1.2)),
      ...Array.from({ length: 20 }, (_, i) => sale(3, i + 1, 3)), // two rings out
      sale(1, 200, 9), // too old even for 180 days
    ];
    const idx = landIndex(rows);
    const r = landRatio({ ...idx, own: 1, ring1: [2], ring2: [3], cityId: 1, atMs: at });
    assert.strictEqual(r.n, 16);
    assert.strictEqual(r.scope, "this neighborhood and the ones bordering it");
    assert.strictEqual(r.p50, 1.5, "own sales count double");
    const wider = landRatio({ ...idx, own: 1, ring1: [], ring2: [3], cityId: 1, atMs: at });
    assert.strictEqual(wider.scope, "this neighborhood and two rings around it");
    const none = landRatio({ comps: () => [], cityComps: () => [], own: 1, cityId: 1, atMs: at });
    assert.strictEqual(none, null);
  });
});

describe("appraisal", () => {
  test("land + building + map assets, with the listing's bundle counted and the last sale's shown", () => {
    const db = openDb(":memory:");
    const now = Date.parse("2026-11-03T00:00:00Z");
    const day = n => new Date(now - n * 86_400_000).toISOString();
    db.prepare("INSERT INTO neighborhood_adjacency (a, b) VALUES (1, 2), (2, 1)").run();
    const prop = db.prepare("INSERT INTO properties (id, address, city_id, city_name, neighborhood_id, neighborhood_name, mint_price, status, updated_at) VALUES (?, ?, 1, 'SF', ?, ?, 1000, 'Owned', 'x')");
    const sale = db.prepare("INSERT INTO property_sales (global_sequence, trx_id, ts, block_num, kind, property_id, buyer, price, currency) VALUES (?, ?, ?, 1, 'upx', ?, 'b', ?, 'UPX')");
    // 30 bare-land sales across neighborhoods 1 and 2 at 1.5x mint (every house sale has 15+ before it)
    for (let i = 0; i < 30; i++) {
      prop.run(`L${i}`, `${i} LAND ST`, i % 2 ? 2 : 1, i % 2 ? "Two" : "One");
      sale.run(`l${i}`, `tl${i}`, day(i + 1), `L${i}`, 1500);
    }
    // 6 sales of single Tiny Houses at 1.5x mint + 2,000
    for (let i = 0; i < 6; i++) {
      prop.run(`H${i}`, `${i} HOUSE ST`, 1, "One");
      sale.run(`h${i}`, `th${i}`, day(i + 2), `H${i}`, 3500);
      db.prepare("INSERT INTO property_buildings (nft_id, property_id, updated_at, token_name, under_construction, built_at) VALUES (?, ?, 'x', 'tiny', 0, ?)").run(100 + i, `H${i}`, day(60));
    }
    db.prepare("INSERT INTO building_types (city_id, token_name, name, buildings, for_sale, refreshed_at) VALUES (1, 'tiny', 'Tiny House', 6, 0, 'x')").run();
    db.prepare("INSERT INTO raw_actions (global_sequence, feed, trx_id, block_num, ts, contract, name, data) VALUES ('b1', 'builds', 'tb', 1, ?, 'sparklettkac', 'transfer', ?)")
      .run(day(1), JSON.stringify({ memo: "BUILD,999,P,1,0,1500000,5000,7200000,structure,tiny,Qm,start" }));
    // Three Tiny Houses built by contract, at 300, 450 and 600 UPX: 200, 300 and 400 UPX per million Sparklet-hours.
    [[1001, 300], [1002, 450], [1003, 600]].forEach(([nft, price], i) => {
      db.prepare("INSERT INTO raw_actions (global_sequence, feed, trx_id, block_num, ts, contract, name, data) VALUES (?, 'builds', ?, 1, ?, 'sparklettkac', 'transfer', ?)")
        .run(`bc${i}`, `tbc${i}`, day(3), JSON.stringify({ memo: `BUILD,${nft},Q${i},1,0,1500000,5000,7200000,structure,tiny,Qm,suspended` }));
      db.prepare("INSERT INTO construction_contracts (global_sequence, trx_id, ts, nft_id, builder, price, fee, fetched_at) VALUES (?, ?, ?, ?, 'b', ?, ?, 'x')")
        .run(`c${i}`, `tc${i}`, day(2), nft, price, price * 0.05);
    });

    // The property being appraised: a Tiny House, listed with a bench on it.
    prop.run("P", "1 MAIN ST", 1, "One");
    db.prepare("INSERT INTO property_buildings (nft_id, property_id, updated_at, token_name, under_construction) VALUES (500, 'P', 'x', 'tiny', 0)").run();
    db.prepare("INSERT INTO nft_items (id, category, token_name, serial, in_escrow) VALUES (77, 'outdoordecor', 'bench', 1, 1), (78, 'outdoordecor', 'lamp', 1, 0)").run();
    db.prepare("INSERT INTO nft_escrow_events (id, global_sequence, ts, block_num, dgood_id, direction, account, kind, property_id) VALUES ('e', '1', ?, 9, 77, 'in', 'me', 'bundle', 'P')").run(day(1));
    db.prepare("INSERT INTO listings_current (property_id, price_upx, price_fiat, snapshot_at) VALUES ('P', 9000, 0, 'x')").run();
    sale.run("p0", "tp0", day(30), "P", 4000);
    db.prepare("INSERT INTO property_sale_nfts (sale_seq, dgood_id) VALUES ('p0', 78), ('p0', 500)").run(); // a lamp and the house's own NFT
    for (const [token, prices] of [["bench", [100, 120, 140]], ["lamp", [50, 60, 70]]]) {
      prices.forEach((p, i) => db.prepare("INSERT INTO nft_sales (global_sequence, trx_id, ts, block_num, price, dg_category, dg_token) VALUES (?, ?, ?, 1, ?, 'outdoordecor', ?)")
        .run(`${token}${i}`, `t${token}${i}`, day(i + 1), p, token));
    }

    const r = refreshAppraisal(db, { now });
    assert.strictEqual(r.sales, 37);
    const tiny = db.prepare("SELECT * FROM building_values WHERE token_name = 'tiny'").get();
    assert.deepStrictEqual([tiny.name, tiny.sales, tiny.median, tiny.hours_needed, tiny.min_stake, tiny.max_stake, tiny.builds_90d, tiny.contracts_90d, tiny.contract_n, tiny.contract_median],
      ["Tiny House", 6, 2000, 1500000, 50, 72000, 4, 3, 3, 450]);
    assert.deepStrictEqual(r.contracts, { n: 3, p25: 250, p50: 300, p75: 350 }, "UPX per million Sparklet-hours");

    const a = appraiseProperty(db, "P", { picks: [{ category: "outdoordecor", token: "lamp", count: 2 }], now });
    assert.strictEqual(a.land.value, 1500);
    assert.strictEqual(a.land.scope, "this neighborhood and the ones bordering it");
    assert.deepStrictEqual(a.buildings.map(b => [b.name, b.value, b.toBuild]), [["Tiny House", 2000, { value: 450, basis: "contracts", n: 3 }]]);
    assert.deepStrictEqual(a.assets.map(x => [x.token, x.source, x.value, x.count]),
      [["bench", "listing", 120, 1], ["lamp", "last sale", 60, 1], ["lamp", "added by you", 60, 2]]);
    assert.deepStrictEqual([a.totals.value, a.totals.assets, a.totals.withAssets], [3500, 240, 3740], "the last sale's lamp is shown, not counted");
    assert.strictEqual(a.listing.upx, 9000);
    assert.deepStrictEqual(a.history.map(h => h.nfts), [1], "the house's own NFT isn't a map asset");
    assert.strictEqual(appraiseProperty(db, "nope", { now }), null);
  });
});

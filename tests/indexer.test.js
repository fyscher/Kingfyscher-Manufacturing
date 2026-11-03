const { test, describe } = require("node:test");
const assert = require("node:assert");

const {
  chainTimeIso,
  toRawAction,
  toRawDelta,
  decodeNftSales,
  decodePropertySalesUpx,
  decodePropertySalesUsd,
  decodeListingEvents,
  decodeOfferEvents,
} = require("../indexer/decode");
const { createClient } = require("../indexer/hyperion");
const { openDb, getCheckpoint } = require("../indexer/db");
const { FEEDS, fetchRange, backfill, tail } = require("../indexer/sync");
const { setCheckpoint } = require("../indexer/db");

// Fixtures follow the real payload shapes recorded 2026-10-15, with every
// account and username replaced: this repo is public.
const action = (seq, trx, block, ts, account, name, data) => ({
  global_sequence: seq,
  trx_id: trx,
  block_num: block,
  "@timestamp": ts,
  act: { account, name, data },
});

const saleN112 = action(1001, "trxsale1", 100, "2026-10-15T23:00:00.000", "playuplandme", "n112", {
  p14: "buyer1111111", p25: "seller111111", p135: null, p141: "630.00 UPX", p142: "30.00 UPX", p143: null,
});
const saleTransfer = action(1002, "trxsale1", 100, "2026-10-15T23:00:00.000", "uplandnftact", "transfernft", {
  from: "playuplandme",
  to: "buyer1111111",
  dgood_ids: ["9252524"],
  memo: 'This transaction notarises that Upland user someplayer with corresponding EOS account buyer1111111 is now the owner of the Seeds NFT "Violets" mint 8221. NFT ID: 9252524, NFT meta data: QmTestCid, initial minting transaction: abc',
});
const mintTransfer = action(1003, "trxmint1", 101, "2026-10-15T23:00:01.000", "uplandnftact", "transfernft", {
  from: "playuplandme",
  to: "minter111111",
  dgood_ids: ["9999999"],
  memo: 'This transaction notarises that Upland user minter with corresponding EOS account minter111111 is the initial owner of the NFT "Lawn Grass" mint 3.',
});

const raw = a => toRawAction("test", a);

describe("indexer decoders", () => {
  test("chain timestamps are read as UTC", () => {
    assert.strictEqual(chainTimeIso("2026-10-16T01:22:03.000"), "2026-10-16T01:22:03.000Z");
    assert.strictEqual(chainTimeIso("2026-10-16T01:22:03.000Z"), "2026-10-16T01:22:03.000Z");
  });

  test("stored memos never keep usernames", () => {
    const stored = raw(saleTransfer);
    assert.ok(!stored.data.memo.includes("someplayer"));
    assert.ok(stored.data.memo.includes("Upland user [redacted]"));
    assert.ok(stored.data.memo.includes("buyer1111111"), "public account ids are kept");
  });

  test("an NFT resale joins n112 to its transfer and prices at the listing price", () => {
    const [sale] = decodeNftSales([raw(saleN112)], [raw(saleTransfer), raw(mintTransfer)]);
    assert.strictEqual(sale.price, 600);
    assert.strictEqual(sale.buyer_paid, 630);
    assert.strictEqual(sale.fee, 30);
    assert.strictEqual(sale.currency, "UPX");
    assert.strictEqual(sale.display_name, "Violets");
    assert.strictEqual(sale.category, "Seeds");
    assert.strictEqual(sale.mint, 8221);
    assert.strictEqual(sale.dgood_id, "9252524");
    assert.strictEqual(sale.buyer, "buyer1111111");
    assert.strictEqual(sale.seller, "seller111111");
  });

  test("a resale whose transfer is missing keeps the price and leaves the item blank", () => {
    const [sale] = decodeNftSales([raw(saleN112)], [raw(mintTransfer)]);
    assert.strictEqual(sale.price, 600);
    assert.strictEqual(sale.display_name, null);
  });

  test("a UPX property resale finds its seller through the n5 payout", () => {
    const n5 = action(2001, "trxprop1", 200, "2026-10-16T01:34:12.500", "playuplandme", "n5", {
      memo: "This transaction notarizes that Upland user someone with EOS account buyer2222222 owns 26 LINKS DR, Cape Town, WC on Upland. Initial minting transaction: abc",
      p14: "buyer2222222",
      a45: "34898393774428",
      p24: "14000.00 UPX",
    });
    const payout = action(2002, "trxprop1", 200, "2026-10-16T01:34:12.500", "upxtokenacct", "transfer", {
      from: "playuplandme", to: "seller222222", amount: 13300, symbol: "UPX", memo: "n5", quantity: "13300.00 UPX",
    });
    const [sale] = decodePropertySalesUpx([raw(n5)], [raw(payout)]);
    assert.deepStrictEqual(
      { kind: sale.kind, price: sale.price, currency: sale.currency, seller: sale.seller, address: sale.address },
      { kind: "upx", price: 14000, currency: "UPX", seller: "seller222222", address: "26 LINKS DR, Cape Town, WC" },
    );
  });

  test("a USD property sale takes its price from the listing removed in the same block", () => {
    const n52 = action(3001, "trxusd1", 300, "2026-10-16T02:00:00.000", "playuplandme", "n52", {
      p14: "buyer3333333", a45: "34934150114841",
    });
    const removed = toRawDelta("t2", {
      block_num: 300, timestamp: "2026-10-16T02:00:00.000", code: "playuplandme", scope: "playuplandme",
      table: "t2", primary_key: "34934150114841", present: 0,
      data: { a34: "34934150114841", a35: "seller333333", f4: "0.00 UPX", f3: "3.06 FIAT", f21: false, f22: false, f23: false },
    });
    const [sale] = decodePropertySalesUsd([raw(n52)], [removed]);
    assert.deepStrictEqual(
      { kind: sale.kind, price: sale.price, currency: sale.currency, seller: sale.seller, buyer: sale.buyer },
      { kind: "usd", price: 3.06, currency: "FIAT", seller: "seller333333", buyer: "buyer3333333" },
    );
  });

  test("listing and offer table changes decode, including the variant price", () => {
    const listing = toRawDelta("t2", {
      block_num: 400, timestamp: "2026-10-16T01:31:21.500", code: "playuplandme", scope: "playuplandme",
      table: "t2", primary_key: "34911094123405", present: 1,
      data: { a34: "34911094123405", a35: "seller444444", f4: "12957.00 UPX", f3: "0.00 FIAT", f21: false, f22: true, f23: false },
    });
    const offer = toRawDelta("t3", {
      block_num: 401, timestamp: "2026-10-16T01:24:43.500", code: "playuplandme", scope: "playuplandme",
      table: "t3", primary_key: "3465089", present: 1,
      data: { f15: "3465089", a35: "owner5555555", f14: "77333991839601", f25: ["asset", "70000.00 UPX"], f31: "offerer55555" },
    });
    const [l] = decodeListingEvents([listing]);
    const [o] = decodeOfferEvents([offer]);
    assert.deepStrictEqual([l.price_upx, l.price_fiat, l.flags, l.present], [12957, 0, "010", 1]);
    assert.deepStrictEqual([o.price, o.currency, o.offerer, o.property_id], [70000, "UPX", "offerer55555", "77333991839601"]);
  });
});

/** A fake clock: sleeping advances time instantly, and every sleep is recorded. */
function fakeClock() {
  let t = 0;
  const sleeps = [];
  return { now: () => t, sleep: async ms => { sleeps.push(ms); t += ms; }, sleeps };
}

const jsonResponse = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: k => headers[k.toLowerCase()] },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

describe("indexer client", () => {
  test("throttles to the configured rate and identifies itself", async () => {
    const clock = fakeClock();
    const seen = [];
    const client = createClient({
      historyUrl: "https://h", rpcUrl: "https://r", requestsPerSecond: 1, userAgent: "kfm-test/1",
      fetchImpl: async (url, init) => { seen.push({ url, ua: init.headers["User-Agent"], at: clock.now() }); return jsonResponse({ actions: [] }); },
      sleep: clock.sleep, now: clock.now,
    });
    await Promise.all([client.getActions({ filter: "a:b" }), client.getActions({ filter: "a:b" }), client.getActions({ filter: "a:b" })]);
    assert.deepStrictEqual(seen.map(s => s.at), [0, 1000, 2000]);
    assert.ok(seen.every(s => s.ua === "kfm-test/1"));
    assert.strictEqual(client.requestCount, 3);
  });

  test("backs off on 429 using Retry-After, then succeeds", async () => {
    const clock = fakeClock();
    let calls = 0;
    const client = createClient({
      historyUrl: "https://h", rpcUrl: "https://r", requestsPerSecond: 10, userAgent: "kfm-test/1",
      fetchImpl: async () => (++calls === 1 ? jsonResponse({}, 429, { "retry-after": "5" }) : jsonResponse({ actions: [1] })),
      sleep: clock.sleep, now: clock.now,
    });
    const res = await client.getActions({ filter: "a:b" });
    assert.deepStrictEqual(res.actions, [1]);
    assert.ok(clock.sleeps.includes(5000));
  });

  test("refuses to run without a User-Agent", () => {
    assert.throws(() => createClient({ historyUrl: "h", rpcUrl: "r" }), /userAgent/);
  });

  test("gives up on a 4xx that retrying can't fix", async () => {
    const client = createClient({
      historyUrl: "https://h", rpcUrl: "https://r", userAgent: "kfm-test/1",
      fetchImpl: async () => jsonResponse({ message: "bad" }, 400), sleep: async () => {}, now: () => 0,
    });
    await assert.rejects(client.getActions({}), /400/);
  });
});

/** In-memory stand-in for Hyperion: answers get_actions/get_deltas from fixture rows by time window. */
function fakeHyperion({ actions = [], deltas = [] }) {
  const inWindow = (ts, p) => {
    const t = Date.parse(chainTimeIso(ts));
    return t >= Date.parse(p.after) && t < Date.parse(p.before);
  };
  const page = (rows, p) => rows.slice(p.skip || 0, (p.skip || 0) + p.limit);
  let requestCount = 0;
  return {
    get requestCount() { return requestCount; },
    getActions: async p => {
      requestCount++;
      const [account, name] = p.filter.split(":");
      const rows = actions.filter(a => a.act.account === account && a.act.name === name && inWindow(a["@timestamp"], p))
        .filter(a => !p["@transfer.memo"] || a.act.data.memo === p["@transfer.memo"]);
      return { actions: page(rows, p) };
    },
    getDeltas: async p => {
      requestCount++;
      return { deltas: page(deltas.filter(d => d.table === p.table && inWindow(d.timestamp, p)), p) };
    },
  };
}

describe("indexer sync", () => {
  test("splits a window that is too dense for Hyperion's skip cap", async () => {
    // Any window wider than 30 minutes claims to be endlessly full; narrow ones return 2 rows.
    const dense = {
      requestCount: 0,
      getActions: async p => {
        const span = Date.parse(p.before) - Date.parse(p.after);
        if (span > 30 * 60_000) return { actions: new Array(1000).fill({}) };
        return { actions: [{ w: p.after }, { w: p.after }] };
      },
    };
    const rows = await fetchRange(dense, FEEDS.n112, Date.parse("2026-10-15T00:00:00Z"), Date.parse("2026-10-15T02:00:00Z"));
    assert.strictEqual(rows.length, 8); // four 30-minute leaves x 2 rows
  });

  test("a backfill decodes sales, is safe to re-run, and keeps its own checkpoint", async () => {
    const db = openDb(":memory:");
    const client = fakeHyperion({ actions: [saleN112, saleTransfer, mintTransfer] });
    const range = { from: "2026-10-15T22:00:00.000Z", to: "2026-10-16T00:00:00.000Z", feeds: ["n112", "nft_transfers"] };

    await backfill({ db, client, ...range });
    await backfill({ db, client, ...range });

    const sales = db.prepare("SELECT display_name, price FROM nft_sales").all();
    assert.deepStrictEqual(sales, [{ display_name: "Violets", price: 600 }]);
    const stored = db.prepare("SELECT COUNT(*) AS n FROM raw_actions WHERE feed = 'nft_transfers'").get().n;
    assert.strictEqual(stored, 2, "both moves out of escrow are kept (the mint feeds the escrow tracker, not sales)");
    assert.strictEqual(getCheckpoint(db, "backfill:n112"), range.to);
    assert.strictEqual(getCheckpoint(db, "tail:n112"), null);
    db.close();
  });
});

describe("indexer tail", () => {
  test("the listing table starts from its snapshot, not ten minutes back", async () => {
    const db = openDb(":memory:");
    setCheckpoint(db, "listings:applied", "2026-11-01T22:50:30.000Z");
    const asked = [];
    const client = {
      requestCount: 0,
      getActions: async () => ({ actions: [] }),
      getDeltas: async p => { asked.push(p); return { deltas: [] }; },
    };
    let cycles = 0;
    await tail({
      db, client, feeds: ["t2"], intervalMs: 0, lagMs: 60_000,
      now: () => Date.parse("2026-11-01T23:20:00.000Z"), sleep: async () => {}, shouldStop: () => cycles++ > 0,
    });
    assert.strictEqual(asked[0].after, "2026-11-01T22:50:30.000Z");
    assert.strictEqual(getCheckpoint(db, "tail:t2"), "2026-11-01T23:19:00.000Z", "then advances, keeping a minute of overlap");
    db.close();
  });
});

describe("indexer tail recovery", () => {
  test("a tail checkpoint ahead of the listing book can't skip changes", async () => {
    const db = openDb(":memory:");
    setCheckpoint(db, "listings:applied", "2026-11-01T22:50:30.000Z");
    setCheckpoint(db, "tail:t2", "2026-11-01T22:57:00.000Z"); // left by an earlier run
    const asked = [];
    const client = { requestCount: 0, getActions: async () => ({ actions: [] }), getDeltas: async p => { asked.push(p); return { deltas: [] }; } };
    let cycles = 0;
    await tail({ db, client, feeds: ["t2"], intervalMs: 0, lagMs: 60_000, now: () => Date.parse("2026-11-01T23:10:00.000Z"),
      sleep: async () => {}, shouldStop: () => cycles++ > 0 });
    assert.strictEqual(asked[0].after, "2026-11-01T22:50:30.000Z", "starts from the earlier mark");
    db.close();
  });
});


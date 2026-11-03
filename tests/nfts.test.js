const { test, describe } = require("node:test");
const assert = require("node:assert");

const { openDb, insertRawActions, setCheckpoint, getCheckpoint } = require("../indexer/db");
const { toRawAction, decodeEscrowEvents, isEscrowTransfer } = require("../indexer/decode");
const { snapshotNfts, applyEscrowEvents, topUpNfts, enrichSales, refreshMarket } = require("../indexer/nfts");
const { tail } = require("../indexer/sync");

const transfer = (seq, ts, block, from, to, ids, memo = "") => ({
  global_sequence: seq, trx_id: `trx${seq}`, block_num: block, "@timestamp": ts,
  act: { account: "uplandnftact", name: "transfernft", data: { from, to, dgood_ids: ids.map(String), memo } },
});
const SALE_MEMO = 'This transaction notarises that Upland user x with corresponding EOS account buyer is now the owner of the Outdoor Decor NFT "Bench" mint 4. NFT ID: 12';
const MINT_MEMO = 'This transaction notarises that Upland user x with corresponding EOS account m is the initial owner of the NFT "Bench" mint 9.';

// A dgood table served 1,000 (or `pageSize`) rows at a time, like chain-api.
function fakeChain(rows, { pageSize = 1000 } = {}) {
  const client = {
    requestCount: 0,
    getTableRows: async body => {
      client.requestCount++;
      const from = Number(body.lower_bound || 0);
      const after = rows.filter(r => r.id >= from).sort((a, b) => a.id - b.id);
      const page = after.slice(0, Math.min(pageSize, body.limit));
      const more = after.length > page.length;
      return { rows: page, more, next_key: more ? String(after[page.length].id) : "" };
    },
  };
  return client;
}
const dgood = (id, category, token, serial, owner) => ({ id, serial_number: serial, owner, category, token_name: token, relative_uri: null });

describe("escrow moves", () => {
  test("listings, delists, resales, store handouts and other moves; player-to-player isn't kept", () => {
    const rows = [
      transfer(1, "2026-11-02T10:00:00.000", 10, "alice", "playuplandme", [7, 8]),
      transfer(2, "2026-11-02T10:01:00.000", 11, "playuplandme", "alice", [8]),
      transfer(3, "2026-11-02T10:02:00.000", 12, "playuplandme", "bob", [7], SALE_MEMO),
      transfer(4, "2026-11-02T10:03:00.000", 13, "carol", "playuplandme", [9], "placed on a listed property"),
      transfer(5, "2026-11-02T10:04:00.000", 14, "playuplandme", "minter", [10], MINT_MEMO), // store stock handed out
      transfer(6, "2026-11-02T10:05:00.000", 15, "dave", "erin", [11]),
    ].map(a => toRawAction("nft_transfers", a));
    assert.deepStrictEqual(rows.map(r => isEscrowTransfer(r.data)), [true, true, true, true, true, false]);
    assert.deepStrictEqual(
      decodeEscrowEvents(rows).map(e => [e.dgood_id, e.direction, e.account, e.kind]),
      [[7, "in", "alice", "listing"], [8, "in", "alice", "listing"], [8, "out", "alice", "delist"],
       [7, "out", "bob", "sale"], [9, "in", "carol", "other"], [10, "out", "minter", "store"]],
    );
  });
});

describe("NFT snapshot", () => {
  const table = [
    dgood(1, "outdoordecor", "bench", 1, "alice"),
    dgood(2, "outdoordecor", "bench", 2, "playuplandme"),
    dgood(3, "blkexplorer", "rock", 1, "playuplandme"), // not a tracked category
    dgood(4, "structornmt", "flag", 1, "bob"),
    dgood(5, "outdoordecor", "bench", 3, "carol"),
  ];

  test("keeps tracked categories, resumes after a stop, and moves made during the read replay from its start", async () => {
    const db = openDb(":memory:");
    const client = fakeChain(table, { pageSize: 2 });
    let pagesLeft = 1;
    const first = await snapshotNfts({ db, client, shouldStop: () => pagesLeft-- <= 0 });
    assert.strictEqual(first.done, false);
    assert.strictEqual(getCheckpoint(db, "snapshot:nfts:cursor"), "3", "next page starts at id 3");
    const started = getCheckpoint(db, "snapshot:nfts:started");

    // While the read was paused, alice listed #1 and #2 sold.
    const later = new Date(Date.parse(started) + 60_000).toISOString().replace("Z", "");
    insertRawActions(db, [
      transfer(20, later, 100, "alice", "playuplandme", [1]),
      transfer(21, later, 100, "playuplandme", "dan", [2], SALE_MEMO),
    ].map(a => toRawAction("nft_transfers", a)));

    const second = await snapshotNfts({ db, client });
    assert.strictEqual(second.done, true);
    assert.strictEqual(getCheckpoint(db, "snapshot:nfts:started"), started, "a resumed read keeps its start time");
    assert.strictEqual(getCheckpoint(db, "nfts:applied"), started, "the snapshot leaves replaying to the tail");
    applyEscrowEvents(db); // what the tail does once it has fetched from the mark
    assert.deepStrictEqual(db.prepare("SELECT id, in_escrow FROM nft_items ORDER BY id").all().map(r => [r.id, r.in_escrow]),
      [[1, 1], [2, 0], [4, 0], [5, 0]]);
    assert.strictEqual(getCheckpoint(db, "nfts:scanned_to"), "5");
    assert.strictEqual(getCheckpoint(db, "snapshot:nfts:cursor"), null);
  });

  test("a move naming an NFT minted after the read pulls it in", async () => {
    const db = openDb(":memory:");
    await snapshotNfts({ db, client: fakeChain(table) });
    const client = fakeChain([...table, dgood(6, "outdoordecor", "lamp", 1, "playuplandme"), dgood(7, "blkexplorer", "rock", 2, "x")]);
    assert.strictEqual(await topUpNfts({ db, client }), 0, "nothing new named yet: no requests");
    assert.strictEqual(client.requestCount, 0);
    insertRawActions(db, [transfer(30, "2099-01-01T00:00:00.000", 200, "zed", "playuplandme", [6])].map(a => toRawAction("nft_transfers", a)));
    applyEscrowEvents(db);
    assert.strictEqual(await topUpNfts({ db, client }), 1);
    assert.deepStrictEqual(db.prepare("SELECT token_name, in_escrow FROM nft_items WHERE id = 6").get(), { token_name: "lamp", in_escrow: 1 });
    assert.strictEqual(getCheckpoint(db, "nfts:scanned_to"), "7");
  });
});

describe("map asset summary", () => {
  test("listed counts only NFTs whose last move in was a listing; prices are sale prices", () => {
    const db = openDb(":memory:");
    const now = Date.parse("2026-11-02T12:00:00Z");
    db.prepare("INSERT INTO designs (category, token_name, category_name_id, max_supply, issued_supply, current_supply, updated_at, base_uri) VALUES ('outdoordecor', 'bench', '55', 100, 40, 40, 'x', 'https://ipfs.io/ipfs/Qm1')").run();
    db.prepare("INSERT INTO design_names (category_name_id, display_name, updated_at) VALUES ('55', 'Park Bench', 'x')").run();
    db.prepare("INSERT INTO designs (category, token_name, category_name_id, max_supply, issued_supply, current_supply, updated_at) VALUES ('outdoordecor', 'lamp', '56', 10, 1, 1, 'x')").run();
    db.prepare("INSERT INTO nft_items (id, category, token_name, serial, in_escrow) VALUES (9, 'outdoordecor', 'lamp', 1, 0)").run();
    const item = db.prepare("INSERT INTO nft_items (id, category, token_name, serial, in_escrow) VALUES (?, 'outdoordecor', 'bench', ?, ?)");
    item.run(1, 1, 1); // listed by alice
    item.run(2, 2, 1); // in escrow since before our history: origin unknown
    item.run(3, 3, 0);
    db.prepare("INSERT INTO nft_escrow_events (id, global_sequence, ts, block_num, dgood_id, direction, account, kind) VALUES ('a', '1', '2026-11-01T00:00:00.000Z', 5, 1, 'in', 'alice', 'listing')").run();
    const sale = db.prepare("INSERT INTO nft_sales (global_sequence, trx_id, ts, block_num, price, dgood_id) VALUES (?, ?, ?, 1, ?, ?)");
    sale.run("s1", "t1", "2026-09-01T00:00:00.000Z", 50, "3"); // too old for the 30-day stats
    sale.run("s2", "t2", "2026-10-20T00:00:00.000Z", 120, "3");
    sale.run("s3", "t3", "2026-10-30T00:00:00.000Z", 100, "3");
    sale.run("s4", "t4", "2026-11-01T00:00:00.000Z", 80, "1");
    sale.run("s5", "t5", "2026-11-01T06:00:00.000Z", 999, "424242"); // an NFT we don't track
    sale.run("s6", "t6", "2026-10-31T00:00:00.000Z", 1, "3"); // a 1-UPX gift
    sale.run("s7", "t7", "2026-10-31T00:00:00.000Z", 1, "9"); // the lamp's only sale: a 1-UPX giveaway

    assert.strictEqual(enrichSales(db), 0, "no tagging before a snapshot has finished");
    setCheckpoint(db, "snapshot:nfts", "2026-11-02T00:00:00.000Z");
    assert.strictEqual(enrichSales(db), 7);
    assert.strictEqual(enrichSales(db), 0, "tagged sales aren't looked up again");
    refreshMarket(db, { now });
    const row = db.prepare("SELECT * FROM market_designs WHERE token_name = 'bench'").get();
    assert.deepStrictEqual(
      [row.display_name, row.escrow, row.listed, row.last_price, row.sales_7d, row.sales_30d, row.median_30d, row.low_30d, row.high_30d, row.floor_30d],
      ["Park Bench", 2, 1, 80, 3, 4, 90, 1, 120, 80],
      "the 1-UPX gift shows in the raw low but never in the floor",
    );
    const lamp = db.prepare("SELECT low_30d, floor_30d FROM market_designs WHERE token_name = 'lamp'").get();
    assert.deepStrictEqual(lamp, { low_30d: 1, floor_30d: null }, "1-UPX giveaways alone give no price");
  });
});

describe("tail and the escrow mark", () => {
  const listing = (seq, ts, id) => transfer(seq, ts, seq, "alice", "playuplandme", [id]);
  function setup() {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO nft_items (id, category, token_name, serial, in_escrow) VALUES (1, 'outdoordecor', 'bench', 1, 0), (2, 'outdoordecor', 'bench', 2, 0)").run();
    setCheckpoint(db, "snapshot:nfts", "2026-11-03T05:47:41.000Z");
    return db;
  }
  const run = (db, client, at) => {
    let cycles = 0;
    return tail({ db, client, feeds: ["nft_transfers"], intervalMs: 0, lagMs: 60_000, now: () => Date.parse(at),
      sleep: async () => {}, shouldStop: () => cycles++ > 0 });
  };
  const chain = rows => ({
    requestCount: 0,
    asked: [],
    getActions: async function (p) {
      this.asked.push(p.after);
      return { actions: rows.filter(r => r["@timestamp"] + "Z" >= p.after && r["@timestamp"] + "Z" < p.before) };
    },
    getTableRows: async () => ({ rows: [] }),
  });

  test("a snapshot finishing mid-cycle can't make the tail step over unfetched moves (2026-11-03)", async () => {
    // The tail was already running from 05:05 when the snapshot (begun 03:53) finished.
    const db = setup();
    setCheckpoint(db, "tail:nft_transfers", "2026-11-03T05:05:00.000Z");
    const rows = [listing(1, "2026-11-03T04:30:00.000", 1), listing(2, "2026-11-03T05:30:00.000", 2)];
    const client = chain(rows);
    const realGetActions = client.getActions;
    client.getActions = async function (p) {
      setCheckpoint(db, "nfts:applied", "2026-11-03T03:53:14.000Z"); // the snapshot finishes now
      return realGetActions.call(this, p);
    };
    await run(db, client, "2026-11-03T05:47:00.000Z");
    assert.strictEqual(client.asked[0], "2026-11-03T05:05:00.000Z");
    assert.strictEqual(getCheckpoint(db, "nfts:applied"), "2026-11-03T03:53:14.000Z", "nothing applied past the unfetched gap");

    client.getActions = realGetActions;
    await run(db, client, "2026-11-03T05:48:00.000Z");
    assert.strictEqual(client.asked.at(-1), "2026-11-03T03:53:14.000Z", "the next cycle fetches from the mark");
    assert.deepStrictEqual(db.prepare("SELECT id, in_escrow FROM nft_items ORDER BY id").all().map(r => r.in_escrow), [1, 1],
      "the 04:30 listing in the gap is applied too");
  });
});

describe("tail", () => {
  test("NFT transfers start from the escrow mark, so a finished snapshot catches up", async () => {
    const db = openDb(":memory:");
    setCheckpoint(db, "nfts:applied", "2026-11-02T08:00:00.000Z");
    const asked = [];
    const client = {
      requestCount: 0,
      getActions: async p => { asked.push(p); return { actions: [] }; },
      getDeltas: async () => ({ deltas: [] }),
      getTableRows: async () => ({ rows: [] }),
    };
    let cycles = 0;
    await tail({ db, client, feeds: ["nft_transfers"], intervalMs: 0, lagMs: 60_000,
      now: () => Date.parse("2026-11-02T11:00:00.000Z"), sleep: async () => {}, shouldStop: () => cycles++ > 0 });
    assert.strictEqual(asked[0].after, "2026-11-02T08:00:00.000Z");
  });
});

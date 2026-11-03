// Map assets for sale. Upland keeps no NFT asking prices on-chain (the
// contract's `asks` table is empty; verified 2026-11-02), but a listed NFT sits
// in escrow, owned by playuplandme, and every move in or out of escrow is a
// transfernft the indexer already collects. So: snapshot which NFTs exist and
// which are in escrow, then follow the escrow moves from when the read began.
const { decodeEscrowEvents } = require("./decode");
const { nowIso, getCheckpoint, setCheckpoint, rawActions, upsert } = require("./db");

const ESCROW = "playuplandme";
const DAY = 86_400_000;

// The Map Assets screen's categories (its "vehicle" is `landvehicle` on-chain).
// Structures are left out: buildings aren't sold apart from their property.
// Changing this needs a fresh `nfts` snapshot, since other categories aren't stored.
const DEFAULT_CATEGORIES = ["outdoordecor", "structornmt", "seeds", "landvehicle", "uppie"];

/**
 * Read the whole dgood table (~9.8M NFTs, 1,000 per request) and keep the
 * tracked categories. Resumable: the cursor is checkpointed after every page.
 * When the read finishes, escrow moves are replayed from when it began.
 */
async function snapshotNfts({ db, client, categories = DEFAULT_CATEGORIES, log = () => {}, shouldStop = () => false }) {
  const wanted = new Set(categories);
  let cursor = getCheckpoint(db, "snapshot:nfts:cursor");
  if (!cursor) {
    // A fresh read: forget the old one, including which design each sale was.
    db.prepare("DELETE FROM nft_items").run();
    db.prepare("DELETE FROM sync_state WHERE feed = 'snapshot:nfts'").run();
    db.prepare("UPDATE nft_sales SET dg_category = NULL, dg_token = NULL").run();
    setCheckpoint(db, "snapshot:nfts:started", nowIso());
    cursor = "0";
  } else log(`nfts: resuming at id ${cursor}`);
  const insert = db.prepare("INSERT OR REPLACE INTO nft_items (id, category, token_name, serial, in_escrow) VALUES (?, ?, ?, ?, ?)");
  let pages = 0;
  let kept = 0;
  for (;;) {
    if (shouldStop()) {
      log("nfts: stopped; rerun to resume");
      return { done: false, kept };
    }
    const res = await client.getTableRows({ code: "uplandnftact", scope: "uplandnftact", table: "dgood", lower_bound: cursor, limit: 1000 });
    const rows = res.rows || [];
    db.transaction(() => {
      for (const r of rows) {
        if (!wanted.has(r.category)) continue;
        insert.run(Number(r.id), r.category, r.token_name, r.serial_number ?? null, r.owner === ESCROW ? 1 : 0);
        kept++;
      }
      if (rows.length) setCheckpoint(db, "nfts:scanned_to", String(rows[rows.length - 1].id));
      if (res.more && res.next_key) setCheckpoint(db, "snapshot:nfts:cursor", String(res.next_key));
    })();
    if (++pages % 200 === 0) log(`nfts: through id ${rows.at(-1)?.id}, ${kept} kept this run (${client.requestCount} requests)`);
    if (!res.more || !res.next_key) break;
    cursor = String(res.next_key);
  }
  db.prepare("DELETE FROM sync_state WHERE feed = 'snapshot:nfts:cursor'").run();
  setCheckpoint(db, "snapshot:nfts", nowIso());
  // Moves made during the read are replayed by the tail, which fetches from this
  // mark first. Applying here could step over moves that haven't been fetched.
  setCheckpoint(db, "nfts:applied", getCheckpoint(db, "snapshot:nfts:started"));
  enrichSales(db);
  refreshMarket(db);
  const total = db.prepare("SELECT COUNT(*) AS n, SUM(in_escrow) AS escrow FROM nft_items").get();
  log(`nfts: ${total.n} tracked NFTs, ${total.escrow} in escrow, ${client.requestCount} requests; run the tail to replay moves since ${getCheckpoint(db, "nfts:applied")}`);
  return { done: true, kept: total.n };
}

/**
 * Bring nft_items forward with the escrow moves stored since the last apply
 * (or since the snapshot began), in chain order. Also records the moves in
 * nft_escrow_events. Returns moves applied. Only call it once the moves since
 * the mark have all been fetched (the tail checks); it advances the mark.
 */
function applyEscrowEvents(db) {
  const since = getCheckpoint(db, "nfts:applied");
  if (!since) return 0;
  const events = decodeEscrowEvents(rawActions(db, "nft_transfers", since, "9999"));
  if (!events.length) return 0;
  upsert(db, "nft_escrow_events", events);
  events.sort((a, b) => a.block_num - b.block_num || a.global_sequence.localeCompare(b.global_sequence, "en", { numeric: true }));
  const set = db.prepare("UPDATE nft_items SET in_escrow = ? WHERE id = ?");
  db.transaction(() => {
    for (const e of events) set.run(e.direction === "in" ? 1 : 0, e.dgood_id);
  })();
  setCheckpoint(db, "nfts:applied", events[events.length - 1].ts);
  return events.length;
}

/**
 * NFTs minted after the snapshot read past their ids aren't in nft_items yet.
 * When an escrow move names one, read the table from the last id scanned.
 */
async function topUpNfts({ db, client, categories = DEFAULT_CATEGORIES }) {
  const scanned = Number(getCheckpoint(db, "nfts:scanned_to"));
  if (!getCheckpoint(db, "snapshot:nfts") || !scanned) return 0;
  const newer = db.prepare("SELECT 1 FROM nft_escrow_events WHERE dgood_id > ? LIMIT 1").get(scanned);
  if (!newer) return 0;
  const wanted = new Set(categories);
  const insert = db.prepare("INSERT OR IGNORE INTO nft_items (id, category, token_name, serial, in_escrow) VALUES (?, ?, ?, ?, ?)");
  let lower = String(scanned + 1);
  let added = 0;
  for (;;) {
    const res = await client.getTableRows({ code: "uplandnftact", scope: "uplandnftact", table: "dgood", lower_bound: lower, limit: 1000 });
    const rows = res.rows || [];
    db.transaction(() => {
      for (const r of rows) {
        if (wanted.has(r.category)) added += insert.run(Number(r.id), r.category, r.token_name, r.serial_number ?? null, r.owner === ESCROW ? 1 : 0).changes;
      }
      if (rows.length) setCheckpoint(db, "nfts:scanned_to", String(rows[rows.length - 1].id));
    })();
    if (!res.more || !res.next_key) return added;
    lower = String(res.next_key);
  }
}

/**
 * Tag each sale with its design from nft_items ('' when it's not a tracked
 * category). Waits for a finished snapshot: mid-read, a missing NFT may just
 * not have been reached yet, and '' is never retried.
 */
function enrichSales(db) {
  if (!getCheckpoint(db, "snapshot:nfts")) return 0;
  return db.prepare(`UPDATE nft_sales SET
      dg_category = COALESCE((SELECT category FROM nft_items WHERE id = CAST(nft_sales.dgood_id AS INTEGER)), ''),
      dg_token = (SELECT token_name FROM nft_items WHERE id = CAST(nft_sales.dgood_id AS INTEGER))
    WHERE dg_category IS NULL AND dgood_id IS NOT NULL`).run().changes;
}

const median = sorted => (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);
const round2 = n => Math.round(n * 100) / 100;

/**
 * Rebuild market_designs: per design, how many are in escrow, how many of those
 * were put there as listings (their latest escrow move is a listing), and recent sale
 * prices. Prices are what sellers received (p141 - p142), never asks.
 */
function refreshMarket(db, { categories = DEFAULT_CATEGORIES, now = Date.now() } = {}) {
  const marks = categories.map(() => "?").join(", ");
  const designs = db.prepare(`SELECT d.category, d.token_name, n.display_name, d.issued_supply, d.max_supply, d.base_uri
    FROM designs d LEFT JOIN design_names n ON n.category_name_id = d.category_name_id
    WHERE d.category IN (${marks})`).all(...categories);

  const key = (c, t) => `${c}/${t}`;
  const escrow = new Map();
  for (const r of db.prepare(`SELECT i.category, i.token_name, COUNT(*) AS escrow,
      SUM(CASE WHEN (SELECT e.kind FROM nft_escrow_events e WHERE e.dgood_id = i.id
                     ORDER BY e.block_num DESC, e.global_sequence DESC LIMIT 1) = 'listing' THEN 1 ELSE 0 END) AS listed
    FROM nft_items i WHERE i.in_escrow = 1 GROUP BY i.category, i.token_name`).all()) {
    escrow.set(key(r.category, r.token_name), r);
  }

  const last = new Map();
  for (const r of db.prepare(`SELECT dg_category, dg_token, price, MAX(ts) AS ts FROM nft_sales
    WHERE dg_category != '' AND price IS NOT NULL GROUP BY dg_category, dg_token`).all()) {
    last.set(key(r.dg_category, r.dg_token), r);
  }

  const since30 = new Date(now - 30 * DAY).toISOString();
  const since7 = new Date(now - 7 * DAY).toISOString();
  const recent = new Map();
  for (const r of db.prepare(`SELECT dg_category, dg_token, ts, price FROM nft_sales
    WHERE ts >= ? AND dg_category != '' AND price IS NOT NULL`).all(since30)) {
    const k = key(r.dg_category, r.dg_token);
    if (!recent.has(k)) recent.set(k, { prices: [], week: 0 });
    const g = recent.get(k);
    g.prices.push(r.price);
    if (r.ts >= since7) g.week++;
  }

  const at = nowIso();
  const insert = db.prepare(`INSERT INTO market_designs (category, token_name, display_name, issued, max_supply, base_uri,
      escrow, listed, last_price, last_sale_at, sales_7d, sales_30d, median_30d, low_30d, high_30d, refreshed_at)
    VALUES (@category, @token_name, @display_name, @issued, @max_supply, @base_uri, @escrow, @listed, @last_price,
      @last_sale_at, @sales_7d, @sales_30d, @median_30d, @low_30d, @high_30d, @refreshed_at)`);
  db.transaction(() => {
    db.prepare("DELETE FROM market_designs").run();
    for (const d of designs) {
      const k = key(d.category, d.token_name);
      const e = escrow.get(k);
      const l = last.get(k);
      const g = recent.get(k);
      const sorted = g ? [...g.prices].sort((a, b) => a - b) : [];
      insert.run({
        category: d.category,
        token_name: d.token_name,
        display_name: d.display_name ?? null,
        issued: d.issued_supply,
        max_supply: d.max_supply,
        base_uri: d.base_uri ?? null,
        escrow: e?.escrow ?? 0,
        listed: e?.listed ?? 0,
        last_price: l?.price ?? null,
        last_sale_at: l?.ts ?? null,
        sales_7d: g?.week ?? 0,
        sales_30d: sorted.length,
        median_30d: sorted.length ? round2(median(sorted)) : null,
        low_30d: sorted.length ? sorted[0] : null,
        high_30d: sorted.length ? sorted[sorted.length - 1] : null,
        refreshed_at: at,
      });
    }
  })();
  setCheckpoint(db, "market:refreshed", at);
  return designs.length;
}

module.exports = { DEFAULT_CATEGORIES, snapshotNfts, applyEscrowEvents, topUpNfts, enrichSales, refreshMarket };

const {
  toRawAction,
  toRawDelta,
  isEscrowTransfer,
  decodeEscrowEvents,
  decodeNftSales,
  decodePropertySalesUpx,
  decodePropertySalesUsd,
  decodeListingEvents,
  decodeOfferEvents,
} = require("./decode");
const {
  insertRawActions,
  insertRawDeltas,
  rawActions,
  rawDeltas,
  upsert,
  getCheckpoint,
  setCheckpoint,
} = require("./db");
const { applyListingDeltas } = require("./floors");
const { applyEscrowEvents, topUpNfts, enrichSales, refreshMarket } = require("./nfts");

const PAGE = 1000; // Hyperion's max limit
const SKIP_CAP = 10_000; // Elasticsearch result window: skip + limit may not exceed this
const MIN_WINDOW_MS = 60_000;
const HOUR = 3_600_000;
const MARKET_REFRESH_MS = 5 * 60_000; // the map asset browser's summary

// What Stage 1 ingests. Window sizes keep a typical window well under one page
// (volumes measured 2026-10-15). `keep` filters rows before they are stored.
const FEEDS = {
  n112: { kind: "actions", params: { filter: "playuplandme:n112" }, windowMin: 360 },
  // Every NFT move into or out of escrow: resales (they name the item in
  // nft_sales), listings, delists and store handouts (they keep the map asset
  // browser's escrow current).
  nft_transfers: {
    kind: "actions",
    params: { filter: "uplandnftact:transfernft" },
    windowMin: 30,
    keep: a => isEscrowTransfer(a.act?.data),
  },
  n5: { kind: "actions", params: { filter: "playuplandme:n5" }, windowMin: 720 },
  n5_payouts: {
    kind: "actions",
    params: { filter: "upxtokenacct:transfer", "@transfer.memo": "n5" },
    windowMin: 720,
  },
  n52: { kind: "actions", params: { filter: "playuplandme:n52" }, windowMin: 720 },
  t2: { kind: "deltas", params: { code: "playuplandme", scope: "playuplandme", table: "t2" }, windowMin: 360 },
  t3: { kind: "deltas", params: { code: "playuplandme", scope: "playuplandme", table: "t3" }, windowMin: 720 },
};

const iso = ms => new Date(ms).toISOString();

class DenseWindowError extends Error {}

/** Every row of one feed in [fromMs, toMs), paging until a short page. */
async function fetchWindow(client, feed, fromMs, toMs) {
  const rows = [];
  for (let skip = 0; ; skip += PAGE) {
    if (skip + PAGE > SKIP_CAP) throw new DenseWindowError(`window ${iso(fromMs)} too dense`);
    const params = { ...feed.params, after: iso(fromMs), before: iso(toMs), sort: "asc", limit: PAGE, skip };
    const res = feed.kind === "actions" ? await client.getActions(params) : await client.getDeltas(params);
    const page = (feed.kind === "actions" ? res.actions : res.deltas) || [];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

/** Like fetchWindow, but halves any window too dense for the skip cap. */
async function fetchRange(client, feed, fromMs, toMs) {
  try {
    return await fetchWindow(client, feed, fromMs, toMs);
  } catch (err) {
    if (!(err instanceof DenseWindowError) || toMs - fromMs <= MIN_WINDOW_MS) throw err;
    const mid = fromMs + Math.floor((toMs - fromMs) / 2);
    return [...(await fetchRange(client, feed, fromMs, mid)), ...(await fetchRange(client, feed, mid, toMs))];
  }
}

/** Fetch one feed's rows for a span and store them; returns rows added. */
async function ingest(db, client, name, fromMs, toMs) {
  const feed = FEEDS[name];
  const fetched = await fetchRange(client, feed, fromMs, toMs);
  const kept = feed.keep ? fetched.filter(feed.keep) : fetched;
  return feed.kind === "actions"
    ? insertRawActions(db, kept.map(a => toRawAction(name, a)))
    : insertRawDeltas(db, kept.map(d => toRawDelta(name, d)));
}

// Backfill and tail keep separate checkpoints: the tail racing ahead must never
// make a historical backfill think the past is already done.
const backfillKey = name => `backfill:${name}`;
const tailKey = name => `tail:${name}`;

/** Only ever move a checkpoint forward. */
function advance(db, key, doneUntilMs) {
  const current = getCheckpoint(db, key);
  if (!current || Date.parse(current) < doneUntilMs) setCheckpoint(db, key, iso(doneUntilMs));
}

/** Rebuild every decoded table for [from, to) from the raw rows already stored. */
function decodeRange(db, from, to) {
  const t2 = rawDeltas(db, "t2", from, to);
  const transfers = rawActions(db, "nft_transfers", from, to);
  const decoded = {
    nft_sales: upsert(db, "nft_sales", decodeNftSales(rawActions(db, "n112", from, to), transfers)),
    nft_escrow_events: upsert(db, "nft_escrow_events", decodeEscrowEvents(transfers)),
    property_sales_upx: upsert(db, "property_sales", decodePropertySalesUpx(rawActions(db, "n5", from, to), rawActions(db, "n5_payouts", from, to))),
    property_sales_usd: upsert(db, "property_sales", decodePropertySalesUsd(rawActions(db, "n52", from, to), t2)),
    property_listing_events: upsert(db, "property_listing_events", decodeListingEvents(t2)),
    property_offer_events: upsert(db, "property_offer_events", decodeOfferEvents(rawDeltas(db, "t3", from, to))),
  };
  enrichSales(db); // re-decoded sales lose their design tag; put it back
  return decoded;
}

/**
 * Backfill [from, to) a day at a time: every feed for the day, then decode the
 * day, so partial runs are already usable. Resumes from each feed's checkpoint
 * when it falls inside the range.
 */
async function backfill({
  db,
  client,
  feeds = Object.keys(FEEDS),
  from,
  to,
  chunkHours = 24,
  log = () => {},
  shouldStop = () => false,
}) {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!(fromMs < toMs)) throw new Error(`bad range ${from} -> ${to}`);
  const startedAt = Date.now();

  for (let chunk = fromMs; chunk < toMs; chunk += chunkHours * HOUR) {
    const chunkEnd = Math.min(chunk + chunkHours * HOUR, toMs);
    for (const name of feeds) {
      const done = getCheckpoint(db, backfillKey(name));
      const doneMs = done ? Date.parse(done) : -Infinity;
      if (doneMs >= chunkEnd && doneMs <= toMs) continue; // this chunk was finished by an earlier run
      let start = doneMs > chunk && doneMs < chunkEnd ? doneMs : chunk;
      const step = FEEDS[name].windowMin * 60_000;
      for (; start < chunkEnd; start += step) {
        if (shouldStop()) return log("backfill stopped; rerun the same command to resume");
        const end = Math.min(start + step, chunkEnd);
        await ingest(db, client, name, start, end);
        advance(db, backfillKey(name), end);
      }
    }
    const decoded = decodeRange(db, iso(chunk), iso(chunkEnd));
    const pct = ((chunkEnd - fromMs) / (toMs - fromMs)) * 100;
    log(`backfill ${iso(chunk).slice(0, 16)} -> ${iso(chunkEnd).slice(0, 16)} done (${pct.toFixed(1)}%), ` +
      `${client.requestCount} requests in ${Math.round((Date.now() - startedAt) / 1000)}s, decoded ${JSON.stringify(decoded)}`);
  }
}

/**
 * Follow the chain live. Each cycle re-reads from `lagMs` behind the last
 * checkpoint (rows dedupe on their keys), then re-decodes the last 30 minutes
 * so joins that straddled a cycle get completed.
 */
async function tail({
  db,
  client,
  feeds = Object.keys(FEEDS),
  intervalMs,
  lagMs,
  log = () => {},
  sleep = ms => new Promise(r => setTimeout(r, ms)),
  shouldStop = () => false,
  now = () => Date.now(),
}) {
  let lastRefresh = 0;
  while (!shouldStop()) {
    const cycleStart = now();
    let added = 0;
    let escrowCovered = false;
    for (const name of feeds) {
      const done = getCheckpoint(db, tailKey(name));
      // The listing book and the NFT escrow must see every change since they
      // were last brought up to date, or they drift: start from the earlier mark.
      const listingsBase = name === "t2" ? getCheckpoint(db, "listings:applied")
        : name === "nft_transfers" ? getCheckpoint(db, "nfts:applied") : null;
      const marks = [done, listingsBase].filter(Boolean).map(Date.parse);
      const fromMs = marks.length ? Math.min(...marks) : cycleStart - 10 * 60_000;
      added += await ingest(db, client, name, fromMs, cycleStart);
      advance(db, tailKey(name), cycleStart - lagMs);
      if (name === "nft_transfers") {
        // Escrow moves may only be applied when this fetch reached back to the
        // escrow mark. Re-read it: a snapshot finishing mid-cycle moves it back,
        // and applying then would step over moves nobody has fetched yet.
        const mark = getCheckpoint(db, "nfts:applied");
        escrowCovered = !!mark && fromMs <= Date.parse(mark);
      }
      // Anything fetched from before the last-applied mark is replayed (in block order, so it's safe).
      if (listingsBase && fromMs < Date.parse(listingsBase)) setCheckpoint(db, name === "t2" ? "listings:applied" : "nfts:applied", iso(fromMs));
    }
    decodeRange(db, iso(cycleStart - 30 * 60_000), iso(cycleStart + 60_000));
    applyListingDeltas(db); // keeps the live listing book (and so the floors) current
    if (escrowCovered) applyEscrowEvents(db); // keeps which map assets are in escrow current
    await topUpNfts({ db, client });
    if (now() - lastRefresh >= MARKET_REFRESH_MS && getCheckpoint(db, "snapshot:nfts")) {
      enrichSales(db);
      refreshMarket(db, { now: now() });
      lastRefresh = now();
    }
    if (added > 0) log(`tail ${iso(cycleStart).slice(11, 19)}: +${added} raw rows, ${client.requestCount} requests total`);
    const wait = intervalMs - (now() - cycleStart);
    if (wait > 0 && !shouldStop()) await sleep(wait);
  }
}

module.exports = { FEEDS, fetchWindow, fetchRange, ingest, decodeRange, backfill, tail, DenseWindowError };

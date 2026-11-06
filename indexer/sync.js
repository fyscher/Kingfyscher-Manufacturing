const {
  toRawAction,
  toRawDelta,
  isEscrowTransfer,
  decodeEscrowEvents,
  isBuildPayment,
  decodeBuilds,
  decodeSaleBundles,
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
const { applyEscrowEvents, topUpNfts, enrichSales, tagBundles, refreshMarket } = require("./nfts");
const { applyBuildingDeltas, applyConstructionDeltas, refreshBuildingTypes } = require("./buildings"); // refresh also fills in new buildings' type and city
const { refreshAppraisal } = require("./appraisal");
const { fetchContractPayouts } = require("./contracts");

const PAGE = 1000; // Hyperion's max limit
const SKIP_CAP = 10_000; // Elasticsearch result window: skip + limit may not exceed this
const MIN_WINDOW_MS = 60_000;
const HOUR = 3_600_000;
const MARKET_REFRESH_MS = 5 * 60_000; // the map asset browser's summary
const BUILDINGS_REFRESH_MS = 15 * 60_000; // the Building Browser's dropdown (one pass over ~650k buildings)
const APPRAISAL_REFRESH_MS = 60 * 60_000; // the appraiser's sale facts, building values and back-test

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
  // skipDense: a minute of table changes too dense to page is a bulk load, not
  // activity (2025-04-28 09:19 UTC: 10,000+ t2 changes, zero sales), so it's
  // recorded as a gap instead of stopping the run. Sales feeds never skip.
  t2: { kind: "deltas", params: { code: "playuplandme", scope: "playuplandme", table: "t2" }, windowMin: 360, skipDense: true },
  t3: { kind: "deltas", params: { code: "playuplandme", scope: "playuplandme", table: "t3" }, windowMin: 720, skipDense: true },
  // When each building went up: SPARKLT payments to escrow, kept only for "BUILD," memos.
  builds: {
    kind: "actions",
    params: { filter: "sparklettkac:transfer", "@transfer.to": "playuplandme" },
    windowMin: 360,
    keep: a => isBuildPayment(a.act?.data),
  },
  // Which building stands on which property (see buildings.js).
  a21: { kind: "deltas", params: { code: "playuplandme", scope: "playuplandme", table: "a21" }, windowMin: 720, skipDense: true },
  // Buildings under construction (see buildings.js): a row leaves when one is finished.
  a23: { kind: "deltas", params: { code: "playuplandme", scope: "playuplandme", table: "a23" }, windowMin: 360, skipDense: true },
  // Construction contracts taken (~55 a day); each one's price is read from its transaction (contracts.js).
  contracts: { kind: "actions", params: { filter: "playuplandme:n151" }, windowMin: 1440 },
};

// Tables the tail keeps current by replaying a feed's changes, each from its own mark.
const REPLAYS = {
  t2: { mark: "listings:applied", apply: db => applyListingDeltas(db) }, // the Floor Board's listing book
  nft_transfers: { mark: "nfts:applied", apply: db => applyEscrowEvents(db) }, // which map assets are in escrow
  a21: { mark: "buildings:applied", apply: db => applyBuildingDeltas(db) }, // which building is on which property
  a23: { mark: "constructions:applied", apply: db => applyConstructionDeltas(db) }, // which buildings are still being built
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

/**
 * Like fetchWindow, but halves any window too dense for the skip cap. A window
 * still too dense at a minute is skipped for skipDense feeds (onSkip is told)
 * and an error for the rest.
 */
async function fetchRange(client, feed, fromMs, toMs, onSkip = () => {}) {
  try {
    return await fetchWindow(client, feed, fromMs, toMs);
  } catch (err) {
    if (!(err instanceof DenseWindowError)) throw err;
    if (toMs - fromMs <= MIN_WINDOW_MS) {
      if (!feed.skipDense) throw err;
      onSkip(fromMs, toMs);
      return [];
    }
    const mid = fromMs + Math.floor((toMs - fromMs) / 2);
    return [...(await fetchRange(client, feed, fromMs, mid, onSkip)), ...(await fetchRange(client, feed, mid, toMs, onSkip))];
  }
}

/** Fetch one feed's rows for a span and store them; returns rows added. */
async function ingest(db, client, name, fromMs, toMs) {
  const feed = FEEDS[name];
  const fetched = await fetchRange(client, feed, fromMs, toMs, (gapFrom, gapTo) => {
    setCheckpoint(db, `gap:${name}:${iso(gapFrom)}`, iso(gapTo));
    console.warn(`${name}: skipped ${iso(gapFrom)} -> ${iso(gapTo)}, too dense to page (a bulk load)`);
  });
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
  const upxSales = decodePropertySalesUpx(rawActions(db, "n5", from, to), rawActions(db, "n5_payouts", from, to));
  const usdSales = decodePropertySalesUsd(rawActions(db, "n52", from, to), t2);
  const decoded = {
    nft_sales: upsert(db, "nft_sales", decodeNftSales(rawActions(db, "n112", from, to), transfers)),
    nft_escrow_events: upsert(db, "nft_escrow_events", decodeEscrowEvents(transfers)),
    building_builds: upsert(db, "building_builds", decodeBuilds(rawActions(db, "builds", from, to))),
    property_sales_upx: upsert(db, "property_sales", upxSales),
    property_sales_usd: upsert(db, "property_sales", usdSales),
    property_sale_nfts: upsert(db, "property_sale_nfts", decodeSaleBundles([...upxSales, ...usdSales], transfers)),
    property_listing_events: upsert(db, "property_listing_events", decodeListingEvents(t2)),
    property_offer_events: upsert(db, "property_offer_events", decodeOfferEvents(rawDeltas(db, "t3", from, to))),
  };
  enrichSales(db); // re-decoded sales lose their design tag; put it back
  decoded.nft_bundles = tagBundles(db, { from, to }); // and escrow moves their property bundle
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

// When Upland refuses the indexer (403: Cloudflare blocked it, e.g. during
// Upland's maintenance on 2026-11-05; 429: rate-limited past the client's own
// retries), wait this long and try again instead of exiting: the process used
// to exit and systemd restarted it every 30 s, 169 times in one outage.
const BLOCKED_STATUSES = new Set([403, 429]);
const BLOCKED_BACKOFF_MS = 15 * 60_000;
const DECODE_OVERLAP_MS = 30 * 60_000;

/**
 * Follow the chain live. Each cycle re-reads from `lagMs` behind the last
 * checkpoint (rows dedupe on their keys), then decodes everything fetched since
 * the last decode (after an outage, the whole gap, a day at a time), starting
 * 30 minutes early so joins that straddled a cycle get completed.
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
  let lastBuildingsRefresh = 0;
  // Not right away: a restart shouldn't hold the first cycles up for a full rebuild.
  let lastAppraisalRefresh = now();
  let blockedSince = null;
  // A long wait in short steps, so a stop request isn't held up for minutes.
  const pause = async ms => {
    for (let left = ms; left > 0 && !shouldStop(); left -= 5_000) await sleep(Math.min(5_000, left));
  };

  async function cycle(cycleStart) {
    let added = 0;
    const covered = [];
    for (const name of feeds) {
      const done = getCheckpoint(db, tailKey(name));
      // A replayed table must see every change since it was last brought up to
      // date, or it drifts: start from the earlier of the two marks.
      const replay = REPLAYS[name];
      const base = replay ? getCheckpoint(db, replay.mark) : null;
      const marks = [done, base].filter(Boolean).map(Date.parse);
      const fromMs = marks.length ? Math.min(...marks) : cycleStart - 10 * 60_000;
      added += await ingest(db, client, name, fromMs, cycleStart);
      advance(db, tailKey(name), cycleStart - lagMs);
      if (replay) {
        // Apply only when this fetch reached back to the mark. Re-read it: a
        // snapshot finishing mid-cycle moves it back, and applying then would
        // step over changes nobody has fetched yet.
        const mark = getCheckpoint(db, replay.mark);
        if (mark && fromMs <= Date.parse(mark)) covered.push(replay);
        // Anything fetched from before the mark is replayed (in block order, so it's safe).
        if (base && fromMs < Date.parse(base)) setCheckpoint(db, replay.mark, iso(fromMs));
      }
    }
    // Decode from the last decode, not just the last 30 minutes: after the
    // 2026-11-05 outage the tail fetched ~24 hours of sales, listings and builds
    // but only ever decoded the newest half hour of them.
    const decodedTo = getCheckpoint(db, "tail:decoded");
    const decodeFrom = Math.min(cycleStart - DECODE_OVERLAP_MS, decodedTo ? Date.parse(decodedTo) : Infinity);
    const decodeTo = cycleStart + 60_000;
    for (let from = decodeFrom; from < decodeTo; from += 24 * HOUR) decodeRange(db, iso(from), iso(Math.min(from + 24 * HOUR, decodeTo)));
    for (const replay of covered) replay.apply(db);
    // Replaying escrow moves rewrites them without their property-bundle tag; put it back.
    tagBundles(db, { from: iso(decodeFrom) });
    setCheckpoint(db, "tail:decoded", iso(cycleStart - DECODE_OVERLAP_MS));
    await topUpNfts({ db, client });
    // A few contract prices per cycle; a backlog is the `contracts` command's job.
    if (feeds.includes("contracts")) await fetchContractPayouts({ db, client, limit: 10 });
    if (now() - lastRefresh >= MARKET_REFRESH_MS && getCheckpoint(db, "snapshot:nfts")) {
      enrichSales(db);
      refreshMarket(db, { now: now() });
      lastRefresh = now();
    }
    if (now() - lastBuildingsRefresh >= BUILDINGS_REFRESH_MS && getCheckpoint(db, "snapshot:buildings")) {
      refreshBuildingTypes(db);
      lastBuildingsRefresh = now();
    }
    if (now() - lastAppraisalRefresh >= APPRAISAL_REFRESH_MS && getCheckpoint(db, "snapshot:buildings")) {
      const r = refreshAppraisal(db, { now: now() });
      log(`appraisal: ${r.sales} sales, ${r.buildingTypes} building types`);
      lastAppraisalRefresh = now();
    }
    return added;
  }

  while (!shouldStop()) {
    const cycleStart = now();
    let added;
    try {
      added = await cycle(cycleStart);
    } catch (err) {
      if (!BLOCKED_STATUSES.has(err.status)) throw err;
      if (blockedSince == null) blockedSince = cycleStart;
      log(`Upland refused the indexer (HTTP ${err.status}); trying again in ${BLOCKED_BACKOFF_MS / 60_000} minutes`);
      await pause(BLOCKED_BACKOFF_MS);
      continue;
    }
    if (blockedSince != null) {
      log(`Upland is answering again after ${Math.round((cycleStart - blockedSince) / 60_000)} minutes; the gap is fetched and decoded`);
      blockedSince = null;
    }
    if (added > 0) log(`tail ${iso(cycleStart).slice(11, 19)}: +${added} raw rows, ${client.requestCount} requests total`);
    const wait = intervalMs - (now() - cycleStart);
    if (wait > 0 && !shouldStop()) await sleep(wait);
  }
}

module.exports = { FEEDS, REPLAYS, fetchWindow, fetchRange, ingest, decodeRange, backfill, tail, DenseWindowError, BLOCKED_BACKOFF_MS };

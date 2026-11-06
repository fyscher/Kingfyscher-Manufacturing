// Property appraiser: value = land + each building + the map assets on it, each
// with a range and the number of sales behind it. The evidence for each rule
// is noted where the rule is.
//
// - Land: bare-land UPX sales (no finished building, no NFTs handed over with
//   the sale) in the property's neighborhood (counted double) and the ones
//   bordering it, 90 days, as price per UPX of mint. Wider only when thin.
// - Buildings: nothing sells a building alone, so a type's value is what buyers
//   paid over the land: price minus the land estimate at that time, over every
//   single-building sale (median, with a 95% band), plus the same property sold
//   before and after it was built.
// - Map assets: their own resales only, so nothing counts twice.
// - USD sales are a different market (about 6,200 UPX per $1 in Nov 2026, not
//   the store's 1,000), so land comps are UPX sales only.
const { nowIso } = require("./db");
const { parseBuildMemo, decodeSaleBundles } = require("./decode");

const DAY = 86_400_000;
const MIN_COMPS = 15;
const WEIGHTS = { own: 2, ring1: 1, ring2: 0.5 };
const PREMIUM_DAYS = 180; // single-building sales a building type's value rests on
const BACKTEST_DAYS = 30;
const TOKEN_PRICE = 1; // a 1-UPX sale is a gift, never a price (see nfts.js)
const GIFT_SHARE = 0.25;
const MIN_BUILDING_SALES = 5; // fewer sales than this and a building type isn't valued (one rare kiosk came out at 65k)

// ── small statistics ──
const sortNum = a => [...a].sort((x, y) => x - y);
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
function weightedQuantile(items, q) {
  if (!items.length) return null;
  const s = [...items].sort((a, b) => a.v - b.v);
  const total = s.reduce((t, x) => t + x.w, 0);
  let acc = 0;
  for (const x of s) {
    acc += x.w;
    if (acc >= q * total) return x.v;
  }
  return s[s.length - 1].v;
}
// Distribution-free 95% band for a median: order statistics n/2 -/+ 0.98 sqrt(n).
function medianBand(sorted) {
  const n = sorted.length;
  if (n < 5) return [null, null];
  const k = 0.98 * Math.sqrt(n);
  return [sorted[Math.max(0, Math.floor(n / 2 - k))], sorted[Math.min(n - 1, Math.ceil(n / 2 + k))]];
}
const round = n => (n == null ? null : Math.round(n));

// ── neighborhoods ──
function adjacencyMap(db) {
  const m = new Map();
  for (const r of db.prepare("SELECT a, b FROM neighborhood_adjacency").all()) {
    if (!m.has(r.a)) m.set(r.a, []);
    m.get(r.a).push(r.b);
  }
  return m;
}
function ringsAround(adj, id) {
  const ring1 = new Set(adj.get(id) || []);
  ring1.delete(id);
  const ring2 = new Set();
  for (const n of ring1) for (const m of adj.get(n) || []) if (m !== id && !ring1.has(m)) ring2.add(m);
  return { ring1: [...ring1], ring2: [...ring2] };
}

// ── land ──
const BARE_UPX = `currency = 'UPX' AND buildings = 0 AND COALESCE(nfts, 0) = 0 AND mint > 0 AND price > ${TOKEN_PRICE}`;
const toComp = r => ({ ...r, tsMs: Date.parse(r.ts), ratio: r.price / r.mint });

/** Comps (sorted by time) of `list` in [fromMs, toMs). */
function between(list, fromMs, toMs) {
  if (!list || !list.length) return [];
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].tsMs < fromMs) lo = mid + 1;
    else hi = mid;
  }
  const out = [];
  for (let i = lo; i < list.length && list[i].tsMs < toMs; i++) out.push(list[i]);
  return out;
}

function summarizeLand(items, scope, days, thin = false) {
  const vs = items.map(c => ({ v: c.ratio, w: c.w }));
  return {
    p25: weightedQuantile(vs, 0.25), p50: weightedQuantile(vs, 0.5), p75: weightedQuantile(vs, 0.75),
    n: items.length, scope, days, thin,
    comps: [...items].sort((a, b) => b.tsMs - a.tsMs),
  };
}

/**
 * Land value per UPX of mint just before `atMs`. `comps(nbhdId)` and
 * `cityComps(cityId)` give bare-land sales sorted by time. Widens only when
 * there are fewer than MIN_COMPS sales: two rings of neighborhoods, then 180
 * days, then the whole city; null when there's nothing to go on.
 */
function landRatio({ comps, cityComps, own, ring1 = [], ring2 = [], cityId, atMs, minComps = MIN_COMPS }) {
  const pick = (ids, w, days, tag) => {
    const out = [];
    for (const id of ids) for (const c of between(comps(id), atMs - days * DAY, atMs)) out.push({ ...c, w, ring: tag });
    return out;
  };
  const near = days => [...(own == null ? [] : pick([own], WEIGHTS.own, days, "own")), ...pick(ring1, WEIGHTS.ring1, days, "bordering")];
  const tries = [
    { scope: "this neighborhood and the ones bordering it", days: 90, items: () => near(90) },
    { scope: "this neighborhood and two rings around it", days: 90, items: () => [...near(90), ...pick(ring2, WEIGHTS.ring2, 90, "two rings out")] },
    { scope: "this neighborhood and two rings around it", days: 180, items: () => [...near(180), ...pick(ring2, WEIGHTS.ring2, 180, "two rings out")] },
  ];
  let best = null;
  for (const t of tries) {
    const items = t.items();
    if (items.length >= minComps) return summarizeLand(items, t.scope, t.days);
    if (!best || items.length > best.items.length) best = { ...t, items };
  }
  if (cityId != null) {
    const city = between(cityComps(cityId), atMs - 90 * DAY, atMs).map(c => ({ ...c, w: 1, ring: "city" }));
    if (city.length >= minComps) return summarizeLand(city, "the whole city", 90);
  }
  if (best && best.items.length >= 3) return summarizeLand(best.items, best.scope, best.days, true);
  return null;
}

/** Bare-land comps grouped by neighborhood and by city, from appraisal_sales. */
function landIndex(rows) {
  const byNbhd = new Map();
  const byCity = new Map();
  for (const r of rows) {
    const c = toComp(r);
    if (r.neighborhood_id != null) {
      if (!byNbhd.has(r.neighborhood_id)) byNbhd.set(r.neighborhood_id, []);
      byNbhd.get(r.neighborhood_id).push(c);
    }
    if (r.city_id != null) {
      if (!byCity.has(r.city_id)) byCity.set(r.city_id, []);
      byCity.get(r.city_id).push(c);
    }
  }
  for (const m of [byNbhd, byCity]) for (const list of m.values()) list.sort((a, b) => a.tsMs - b.tsMs);
  return { comps: id => byNbhd.get(id) || [], cityComps: id => byCity.get(id) || [] };
}

// ── refresh: the tables the appraiser reads ──

/**
 * Rebuild appraisal_sales: every property sale with what stood on the property
 * then (finished buildings whose construction began before the sale; one that
 * was still unfinished at the time counts as built, since finish dates aren't
 * stored historically) and how many non-building NFTs came with it (NULL
 * before the stored NFT transfer history).
 */
function rebuildAppraisalSales(db) {
  const coverage = db.prepare("SELECT MIN(ts) AS t FROM raw_actions WHERE feed = 'nft_transfers'").get().t || "9999";
  const standing = `FROM property_buildings b WHERE b.property_id = s.property_id AND b.under_construction = 0 AND (b.built_at IS NULL OR b.built_at <= s.ts)`;
  const cols = "global_sequence, property_id, ts, price, currency, mint, city_id, neighborhood_id, buildings, token_name, nfts";
  // Build the new rows in a temp table first (that only reads the database), then
  // swap them in. One transaction doing both held the write lock for so long that
  // a contract-price job running beside the hourly refresh died on SQLITE_BUSY
  // (2026-11-04).
  db.exec(`DROP TABLE IF EXISTS temp.appraisal_sales_new;
    CREATE TEMP TABLE appraisal_sales_new AS SELECT * FROM main.appraisal_sales WHERE 0`);
  db.prepare(`INSERT INTO temp.appraisal_sales_new (${cols})
    SELECT s.global_sequence, s.property_id, s.ts, s.price, s.currency, p.mint_price, p.city_id, p.neighborhood_id,
      (SELECT COUNT(*) ${standing}),
      (SELECT CASE WHEN COUNT(*) = 1 THEN MAX(b.token_name) END ${standing}),
      CASE WHEN s.ts >= @coverage THEN (SELECT COUNT(*) FROM property_sale_nfts n LEFT JOIN nft_items i ON i.id = n.dgood_id
        WHERE n.sale_seq = s.global_sequence AND COALESCE(i.category, '') != 'structure'
          AND NOT EXISTS (SELECT 1 FROM property_buildings pb WHERE pb.nft_id = n.dgood_id)) END
    FROM property_sales s JOIN properties p ON p.id = s.property_id
    WHERE s.price > ${TOKEN_PRICE}`).run({ coverage });
  db.transaction(() => {
    db.prepare("DELETE FROM main.appraisal_sales").run();
    db.prepare(`INSERT INTO main.appraisal_sales (${cols}) SELECT ${cols} FROM temp.appraisal_sales_new`).run();
  })();
  db.exec("DROP TABLE temp.appraisal_sales_new");
  return { rows: db.prepare("SELECT COUNT(*) AS n FROM appraisal_sales").get().n, nftHistoryFrom: coverage === "9999" ? null : coverage };
}

/**
 * Per building type, the rules of its latest BUILD memo and how often it was
 * started in 90 days; plus the memo of each build in `wantNfts` (byNft).
 */
function buildRules(db, nowMs, wantNfts = new Set()) {
  const since = new Date(nowMs - 90 * DAY).toISOString();
  const rules = new Map();
  const byNft = new Map();
  for (const r of db.prepare("SELECT ts, data FROM raw_actions WHERE feed = 'builds' ORDER BY ts").all()) {
    const m = parseBuildMemo(JSON.parse(r.data).memo);
    if (!m || !m.token_name) continue;
    if (wantNfts.has(m.nft_id)) byNft.set(m.nft_id, m);
    const k = rules.get(m.token_name) || { builds_90d: 0, contracts_90d: 0 };
    Object.assign(k, { hours_needed: m.hours_needed, min_stake: m.min_stake, max_stake: m.max_stake });
    if (r.ts >= since) {
      k.builds_90d++;
      if (m.contract) k.contracts_90d++;
    }
    rules.set(m.token_name, k);
  }
  return Object.assign(rules, { byNft });
}

/**
 * Rebuild everything the appraiser reads: appraisal_sales, building_values
 * (market premium per type, before/after pairs, build rules) and the stats the
 * page shows (back-test, the USD market rate, what bundled decor adds).
 */
function refreshAppraisal(db, { now = Date.now() } = {}) {
  const sales = rebuildAppraisalSales(db);
  const adj = adjacencyMap(db);
  const bare = db.prepare(`SELECT global_sequence, property_id, ts, price, mint, neighborhood_id, city_id, nfts FROM appraisal_sales WHERE ${BARE_UPX}`).all();
  const index = landIndex(bare);
  const ringCache = new Map();
  const rings = id => {
    if (!ringCache.has(id)) ringCache.set(id, ringsAround(adj, id));
    return ringCache.get(id);
  };
  const landAt = (s, atMs) => (s.mint > 0 ? landRatio({ ...index, own: s.neighborhood_id, ...rings(s.neighborhood_id), cityId: s.city_id, atMs }) : null);

  // Market premium: single-building UPX sales, price minus the land just before.
  const premiums = new Map();
  const premiumSince = new Date(now - PREMIUM_DAYS * DAY).toISOString();
  for (const s of db.prepare(`SELECT * FROM appraisal_sales WHERE currency = 'UPX' AND buildings = 1 AND token_name IS NOT NULL
      AND COALESCE(nfts, 0) = 0 AND mint > 0 AND ts >= ?`).all(premiumSince)) {
    const land = landAt(s, Date.parse(s.ts));
    if (!land || land.thin) continue;
    if (!premiums.has(s.token_name)) premiums.set(s.token_name, []);
    premiums.get(s.token_name).push(s.price - s.mint * land.p50);
  }

  // Before/after: the same property sold bare, then with this one building; the
  // land's own move in between (its neighborhood's ratio then vs now) is taken out.
  const pairs = new Map();
  let prev = null;
  for (const s of db.prepare(`SELECT * FROM appraisal_sales WHERE currency = 'UPX' AND mint > 0 ORDER BY property_id, ts`).all()) {
    if (prev && prev.property_id === s.property_id && prev.buildings === 0 && s.buildings === 1 && s.token_name) {
      const before = landAt(prev, Date.parse(prev.ts));
      const after = landAt(s, Date.parse(s.ts));
      if (before && after) {
        if (!pairs.has(s.token_name)) pairs.set(s.token_name, []);
        pairs.get(s.token_name).push(s.price - prev.price - s.mint * (after.p50 - before.p50));
      }
    }
    prev = s;
  }

  // Construction contracts taken in 90 days: what owners paid to have each build done.
  const contracts = db.prepare(`SELECT nft_id, price FROM construction_contracts WHERE price > 0 AND ts >= ?`).all(new Date(now - 90 * DAY).toISOString());
  const rules = buildRules(db, now, new Set(contracts.map(c => c.nft_id)));
  const contractPrices = new Map();
  const rates = [];
  for (const c of contracts) {
    const m = rules.byNft.get(c.nft_id);
    if (!m || !(m.hours_needed > 0)) continue;
    if (!contractPrices.has(m.token_name)) contractPrices.set(m.token_name, []);
    contractPrices.get(m.token_name).push(c.price);
    rates.push((c.price / m.hours_needed) * 1e6);
  }
  const names = new Map(db.prepare("SELECT token_name, MAX(name) AS name FROM building_types GROUP BY token_name").all().map(r => [r.token_name, r.name]));
  const tokens = new Set([...premiums.keys(), ...pairs.keys(), ...rules.keys(), ...contractPrices.keys()]);
  const at = nowIso();
  const insert = db.prepare(`INSERT INTO building_values (token_name, name, sales, p25, median, p75, ci_low, ci_high, pairs, pair_median,
      hours_needed, min_stake, max_stake, builds_90d, contracts_90d, contract_n, contract_median, refreshed_at)
    VALUES (@token_name, @name, @sales, @p25, @median, @p75, @ci_low, @ci_high, @pairs, @pair_median,
      @hours_needed, @min_stake, @max_stake, @builds_90d, @contracts_90d, @contract_n, @contract_median, @refreshed_at)`);
  db.transaction(() => {
    db.prepare("DELETE FROM building_values").run();
    for (const t of tokens) {
      const p = sortNum(premiums.get(t) || []);
      const q = sortNum(pairs.get(t) || []);
      const [ciLow, ciHigh] = medianBand(p);
      const r = rules.get(t) || {};
      const cp = sortNum(contractPrices.get(t) || []);
      insert.run({
        token_name: t, name: names.get(t) ?? null, sales: p.length,
        p25: round(quantile(p, 0.25)), median: round(quantile(p, 0.5)), p75: round(quantile(p, 0.75)),
        ci_low: round(ciLow), ci_high: round(ciHigh), pairs: q.length, pair_median: round(quantile(q, 0.5)),
        hours_needed: r.hours_needed ?? null, min_stake: r.min_stake ?? null, max_stake: r.max_stake ?? null,
        builds_90d: r.builds_90d ?? 0, contracts_90d: r.contracts_90d ?? 0,
        contract_n: cp.length, contract_median: round(quantile(cp, 0.5)), refreshed_at: at,
      });
    }
  })();

  const sortedRates = sortNum(rates);
  const stats = {
    ...appraisalStats(db, { index, landAt, now }),
    // UPX per million Sparklet-hours, from what owners paid builders (90 days).
    contracts: sortedRates.length ? { n: sortedRates.length, p25: quantile(sortedRates, 0.25), p50: quantile(sortedRates, 0.5), p75: quantile(sortedRates, 0.75) } : null,
  };
  db.prepare(`INSERT INTO appraisal_stats (key, value, refreshed_at) VALUES ('summary', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, refreshed_at = excluded.refreshed_at`)
    .run(JSON.stringify({ ...stats, sales: sales.rows, nftHistoryFrom: sales.nftHistoryFrom }), at);
  return { sales: sales.rows, buildingTypes: tokens.size, ...stats };
}

function errorStats(rows) {
  if (!rows.length) return { n: 0 };
  const errs = sortNum(rows.map(r => Math.abs(r.est - r.price) / r.price));
  return {
    n: rows.length,
    medianError: quantile(errs, 0.5),
    within25: errs.filter(e => e <= 0.25).length / errs.length,
    insideRange: rows.filter(r => r.low != null && r.price >= r.low && r.price <= r.high).length / rows.length,
  };
}

/** Back-test, the USD market rate, and what bundled decor does to a sale price. */
function appraisalStats(db, { landAt, now }) {
  const since90 = new Date(now - 90 * DAY).toISOString();
  const sinceTest = new Date(now - BACKTEST_DAYS * DAY).toISOString();

  // Land, appraised from sales before each one only.
  const landRows = [];
  for (const s of db.prepare(`SELECT * FROM appraisal_sales WHERE ${BARE_UPX} AND nfts = 0 AND ts >= ?`).all(sinceTest)) {
    const l = landAt(s, Date.parse(s.ts));
    if (l && !l.thin) landRows.push({ price: s.price, est: s.mint * l.p50, low: s.mint * l.p25, high: s.mint * l.p75 });
  }
  // Land plus one building (the building's value uses the whole history, so this flatters it a little).
  const values = new Map(db.prepare("SELECT token_name, median, p25, p75 FROM building_values WHERE sales >= 5").all().map(v => [v.token_name, v]));
  const builtRows = [];
  for (const s of db.prepare(`SELECT * FROM appraisal_sales WHERE currency = 'UPX' AND buildings = 1 AND nfts = 0 AND mint > 0 AND ts >= ?`).all(sinceTest)) {
    const v = values.get(s.token_name);
    const l = landAt(s, Date.parse(s.ts));
    if (v && l && !l.thin) builtRows.push({ price: s.price, est: s.mint * l.p50 + v.median, low: s.mint * l.p25 + v.p25, high: s.mint * l.p75 + v.p75 });
  }

  // Do buyers pay for decor that comes with bare land? Price vs the land estimate, with and without.
  const rel = { with: [], without: [] };
  for (const s of db.prepare(`SELECT * FROM appraisal_sales WHERE currency = 'UPX' AND buildings = 0 AND nfts IS NOT NULL AND mint > 0 AND ts >= ?`).all(since90)) {
    const l = landAt(s, Date.parse(s.ts));
    if (l && !l.thin) rel[s.nfts > 0 ? "with" : "without"].push(s.price / (s.mint * l.p50));
  }

  // The property market's own UPX-per-dollar rate (bare land, 90 days).
  const ratio = cur => sortNum(db.prepare(`SELECT price / mint AS r FROM appraisal_sales WHERE currency = ? AND buildings = 0 AND mint > 0 AND ts >= ?`).all(cur, since90).map(r => r.r));
  const upx = ratio("UPX");
  const usd = ratio("FIAT");
  return {
    backtest: { days: BACKTEST_DAYS, land: errorStats(landRows), withBuilding: errorStats(builtRows) },
    decor: {
      withNfts: rel.with.length, without: rel.without.length,
      medianWith: quantile(sortNum(rel.with), 0.5), medianWithout: quantile(sortNum(rel.without), 0.5),
    },
    usd: upx.length && usd.length ? { upxPerUsd: Math.round(quantile(upx, 0.5) / quantile(usd, 0.5)), upxSales: upx.length, usdSales: usd.length } : null,
  };
}

/** Fill property_sale_nfts for the whole stored NFT transfer history, a day at a time. */
function fillSaleBundles(db, { log = () => {} } = {}) {
  const first = db.prepare("SELECT MIN(ts) AS t FROM raw_actions WHERE feed = 'nft_transfers'").get().t;
  if (!first) return 0;
  const sales = db.prepare("SELECT global_sequence, trx_id, buyer FROM property_sales WHERE ts >= ? AND ts < ?");
  const transfers = db.prepare("SELECT trx_id, data FROM raw_actions WHERE feed = 'nft_transfers' AND ts >= ? AND ts < ?");
  const insert = db.prepare("INSERT OR IGNORE INTO property_sale_nfts (sale_seq, dgood_id) VALUES (@sale_seq, @dgood_id)");
  let total = 0;
  for (let d = Date.parse(first.slice(0, 10)); d < Date.now() + DAY; d += DAY) {
    const from = new Date(d).toISOString();
    const to = new Date(d + DAY).toISOString();
    const rows = decodeSaleBundles(sales.all(from, to), transfers.all(from, to).map(t => ({ trx_id: t.trx_id, data: JSON.parse(t.data) })));
    db.transaction(() => {
      for (const r of rows) total += insert.run(r).changes;
    })();
  }
  log(`sale bundles: ${total} NFTs handed over with property sales since ${first.slice(0, 10)}`);
  return total;
}

// ── map assets ──

/**
 * What one map asset design is worth: the median of its real resales over 30
 * days, widening to 90 days, then everything stored, until there are 3. Gifts
 * (1 UPX, or under a quarter of the median once there are 3 real sales) are left out.
 */
function designValue(db, category, token, nowMs = Date.now()) {
  const d = db.prepare("SELECT display_name, floor_30d, sales_30d FROM market_designs WHERE category = ? AND token_name = ?").get(category, token);
  const all = db.prepare("SELECT ts, price FROM nft_sales WHERE dg_category = ? AND dg_token = ? AND price > ? ORDER BY ts DESC LIMIT 1000")
    .all(category, token, TOKEN_PRICE);
  const ref = all.length >= 3 ? quantile(sortNum(all.map(s => s.price)), 0.5) : null;
  const real = ref == null ? all : all.filter(s => s.price >= ref * GIFT_SHARE);
  let windowDays = null;
  let used = [];
  for (const days of [30, 90, null]) {
    used = days ? real.filter(s => Date.parse(s.ts) >= nowMs - days * DAY) : real;
    windowDays = days;
    if (used.length >= 3) break;
  }
  const prices = sortNum(used.map(s => s.price));
  return {
    category, token, name: d?.display_name || token,
    value: quantile(prices, 0.5), low: quantile(prices, 0.25), high: quantile(prices, 0.75),
    floor: d?.floor_30d ?? null, sales: prices.length, windowDays: prices.length ? windowDays : null,
    thin: prices.length < 3,
  };
}

const NOT_MAP_ASSETS = new Set(["structure"]); // a building's own NFT is the building

/** Group NFT ids into designs with counts; buildings and untracked NFTs are counted apart. */
function designsOf(db, ids) {
  const item = db.prepare("SELECT category, token_name FROM nft_items WHERE id = ?");
  const building = db.prepare("SELECT 1 FROM property_buildings WHERE nft_id = ?");
  const groups = new Map();
  let untracked = 0;
  for (const id of ids) {
    const i = item.get(id);
    if (!i) {
      if (!building.get(id)) untracked++;
    }
    else if (!NOT_MAP_ASSETS.has(i.category)) {
      const k = `${i.category}/${i.token_name}`;
      groups.set(k, { category: i.category, token: i.token_name, count: (groups.get(k)?.count || 0) + 1 });
    }
  }
  return { designs: [...groups.values()], untracked };
}

// ── one property ──

const MIN_CONTRACTS = 3;
/**
 * What having one built costs: the median contract price for that building
 * when there are 3+ in 90 days, else its Sparklet-hours at the going contract
 * rate (UPX per million Sparklet-hours).
 */
function buildCost(v, stats) {
  if (!v) return null;
  if (v.contract_n >= MIN_CONTRACTS) return { value: v.contract_median, basis: "contracts", n: v.contract_n };
  if (v.hours_needed > 0 && stats?.contracts?.p50) return { value: Math.round((v.hours_needed * stats.contracts.p50) / 1e6), basis: "rate", n: stats.contracts.n };
  return null;
}

/**
 * Appraise one property now. `picks` = map asset designs the user says are on
 * it ([{category, token, count}]): Upland records placed NFTs only when the
 * property is listed or sold.
 */
function appraiseProperty(db, propertyId, { picks = [], now = Date.now() } = {}) {
  const id = String(propertyId);
  const property = db.prepare("SELECT * FROM properties WHERE id = ?").get(id);
  const salesHere = db.prepare(`SELECT s.global_sequence, s.ts, s.price, s.currency, s.buyer, s.seller, s.address,
      (SELECT COUNT(*) FROM property_sale_nfts n LEFT JOIN nft_items i ON i.id = n.dgood_id
        WHERE n.sale_seq = s.global_sequence AND COALESCE(i.category, '') != 'structure'
          AND NOT EXISTS (SELECT 1 FROM property_buildings pb WHERE pb.nft_id = n.dgood_id)) AS nfts
    FROM property_sales s WHERE s.property_id = ? ORDER BY s.ts DESC`).all(id);
  if (!property && !salesHere.length) return null;

  // Land
  let land = null;
  if (property?.mint_price > 0) {
    const adj = adjacencyMap(db);
    const own = property.neighborhood_id;
    const { ring1, ring2 } = own == null ? { ring1: [], ring2: [] } : ringsAround(adj, own);
    const ids = [own, ...ring1, ...ring2].filter(x => x != null);
    const since = new Date(now - 180 * DAY).toISOString();
    const rows = ids.length
      ? db.prepare(`SELECT global_sequence, property_id, ts, price, mint, neighborhood_id, city_id FROM appraisal_sales
          WHERE ${BARE_UPX} AND ts >= ? AND neighborhood_id IN (${ids.map(() => "?").join(", ")})`).all(since, ...ids)
      : [];
    const near = landIndex(rows);
    let cityList = null;
    const cityComps = cityId => {
      if (!cityList) {
        cityList = landIndex(db.prepare(`SELECT global_sequence, property_id, ts, price, mint, neighborhood_id, city_id FROM appraisal_sales
          WHERE ${BARE_UPX} AND ts >= ? AND city_id = ?`).all(new Date(now - 90 * DAY).toISOString(), cityId)).cityComps(cityId);
      }
      return cityList;
    };
    const r = landRatio({ comps: near.comps, cityComps, own, ring1, ring2, cityId: property.city_id, atMs: now });
    if (r) {
      const addr = db.prepare("SELECT address, neighborhood_name FROM properties WHERE id = ?");
      land = {
        low: property.mint_price * r.p25, value: property.mint_price * r.p50, high: property.mint_price * r.p75,
        ratio: { p25: r.p25, p50: r.p50, p75: r.p75 }, comps: r.n, scope: r.scope, days: r.days, thin: r.thin,
        recent: r.comps.slice(0, 12).map(c => ({
          ts: c.ts, price: c.price, mint: c.mint, ratio: c.ratio, ring: c.ring, propertyId: c.property_id, ...addr.get(c.property_id),
        })),
      };
    }
  }

  // Buildings
  const values = db.prepare("SELECT * FROM building_values WHERE token_name = ?");
  const eta = db.prepare("SELECT eta FROM constructions WHERE nft_id = ?");
  const stats = JSON.parse(db.prepare("SELECT value FROM appraisal_stats WHERE key = 'summary'").get()?.value || "{}");
  const names = db.prepare("SELECT MAX(name) AS name FROM building_types WHERE token_name = ?");
  const buildings = db.prepare("SELECT nft_id, token_name, under_construction, built_at FROM property_buildings WHERE property_id = ?").all(id).map(b => {
    const v = b.token_name ? values.get(b.token_name) : null;
    const ok = v && v.sales >= MIN_BUILDING_SALES;
    return {
      nftId: b.nft_id, token: b.token_name, name: v?.name || (b.token_name && names.get(b.token_name)?.name) || b.token_name || "Unidentified building",
      builtAt: b.built_at, unfinished: b.under_construction === 1, finishes: b.under_construction === 1 ? eta.get(b.nft_id)?.eta ?? null : null,
      // A building can't be worth less than nothing, whatever a noisy sale says.
      value: ok ? Math.max(0, v.median) : null, low: ok ? Math.max(0, v.p25) : null, high: ok ? Math.max(0, v.p75) : null,
      band: ok ? [v.ci_low, v.ci_high] : null, sales: v?.sales ?? 0, pairs: v?.pairs ?? 0, pairMedian: v?.pair_median ?? null,
      hoursNeeded: v?.hours_needed ?? null, toBuild: buildCost(v, stats),
    };
  });
  const finished = buildings.filter(b => !b.unfinished);
  const unvalued = finished.filter(b => b.value == null);

  // Map assets: on its listing, handed over at its last sale, or picked by the user.
  const listedIds = db.prepare(`SELECT DISTINCT e.dgood_id AS id FROM nft_escrow_events e JOIN nft_items i ON i.id = e.dgood_id AND i.in_escrow = 1
    WHERE e.property_id = ? AND e.kind = 'bundle'
      AND NOT EXISTS (SELECT 1 FROM nft_escrow_events x WHERE x.dgood_id = e.dgood_id AND x.block_num > e.block_num)`).all(id).map(r => r.id);
  const lastSale = salesHere[0] || null;
  const lastSaleIds = lastSale ? db.prepare("SELECT dgood_id AS id FROM property_sale_nfts WHERE sale_seq = ?").all(lastSale.global_sequence).map(r => r.id) : [];
  const valued = (list, source) => list.map(x => ({ ...designValue(db, x.category, x.token, now), count: x.count || 1, source }));
  const onListing = designsOf(db, listedIds);
  const atLastSale = designsOf(db, lastSaleIds);
  const assets = [
    ...valued(onListing.designs, "listing"),
    ...valued(atLastSale.designs, "last sale"),
    ...valued(picks.filter(p => p.category && p.token), "added by you"),
  ];

  const listing = db.prepare("SELECT price_upx, price_fiat, snapshot_at FROM listings_current WHERE property_id = ?").get(id) || null;
  const sum = (xs, f) => xs.reduce((t, x) => t + (f(x) ?? 0), 0);
  // Counted in the total: what's escrowed with its listing now, and what the user
  // added. What came with the last sale may have been moved since, so it's shown only.
  const countedAssets = assets.filter(a => a.source !== "last sale");
  const propertyTotal = land ? { low: land.low + sum(finished, b => b.low), value: land.value + sum(finished, b => b.value), high: land.high + sum(finished, b => b.high) } : null;
  const assetsTotal = sum(countedAssets, a => (a.value ?? 0) * a.count);

  return {
    property: property ? {
      id, address: property.address, city: property.city_name, cityId: property.city_id, neighborhood: property.neighborhood_name,
      neighborhoodId: property.neighborhood_id, mint: property.mint_price, status: property.status,
    } : { id, address: salesHere.find(s => s.address)?.address ?? null },
    land,
    buildings,
    buildingsNote: finished.length > 1 ? "Several buildings: each value comes from single-building sales, so the sum is rough." : null,
    unvaluedBuildings: unvalued.length,
    minBuildingSales: MIN_BUILDING_SALES,
    assets,
    lastSaleAt: lastSale?.ts ?? null,
    untrackedNfts: onListing.untracked + atLastSale.untracked,
    totals: propertyTotal ? { ...propertyTotal, assets: assetsTotal, withAssets: propertyTotal.value + assetsTotal } : null,
    listing: listing ? {
      upx: listing.price_upx || null, usd: listing.price_fiat || null,
      usdInUpx: listing.price_fiat && stats.usd ? listing.price_fiat * stats.usd.upxPerUsd : null, asOf: listing.snapshot_at,
    } : null,
    history: salesHere.map(s => ({ ts: s.ts, price: s.price, currency: s.currency, nfts: s.nfts })),
    stats,
  };
}

module.exports = {
  quantile, weightedQuantile, medianBand, ringsAround, landRatio, landIndex, between,
  rebuildAppraisalSales, buildRules, refreshAppraisal, fillSaleBundles, designValue, appraiseProperty, buildCost, MIN_COMPS,
};

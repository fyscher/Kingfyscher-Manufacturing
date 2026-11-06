// Map asset browser: every design of the tracked categories, what's in escrow
// (listed for sale, or held), and what they actually sold for. Reads the
// indexer database only. Asking prices aren't on-chain, so prices here are
// sale prices: what sellers received (p141 - p142).
const marketRouter = require("express").Router();
const { indexerDb } = require("../../utils/indexerDb");
const { userExtractor } = require("../../middleware");

// Signed-in only: the asset page names the chain accounts behind listings, and
// nothing about individual players is shown publicly.
marketRouter.use(userExtractor);

const NO_DATA = {
  error: "Map asset data isn't available on this server: it needs the indexer database (run `npm run indexer -- designs`, then `-- nfts`).",
};

// What Upland's own memos call each category (the Map Assets screen uses the same words).
const CATEGORY_LABELS = {
  outdoordecor: "Outdoor Decor",
  structornmt: "Structure Ornaments",
  seeds: "Seeds",
  landvehicle: "Vehicles",
  uppie: "Uppies",
};

// "Price" for filtering and sorting: the cheapest it sold for in 30 days, gifts
// left out. Designs without a real recent sale sort last and drop out of price filters.
const PRICE = "floor_30d";
const SORTS = {
  listed: "listed DESC, escrow DESC, sales_30d DESC",
  cheapest: `${PRICE} IS NULL, ${PRICE} ASC`,
  priciest: `${PRICE} IS NULL, ${PRICE} DESC`,
  traded: "sales_30d DESC, sales_7d DESC",
  recent: "last_sale_at IS NULL, last_sale_at DESC",
  rarest: "issued IS NULL, issued ASC",
  name: "display_name IS NULL, display_name COLLATE NOCASE ASC",
};

const checkpoint = (db, key) => db.prepare("SELECT done_until FROM sync_state WHERE feed = ?").get(key)?.done_until ?? null;

function freshness(db) {
  const sales = db.prepare("SELECT MIN(ts) AS first, MAX(ts) AS last, COUNT(*) AS n FROM nft_sales WHERE dg_category != ''").get();
  return {
    snapshotAt: checkpoint(db, "snapshot:nfts"),
    escrowAsOf: checkpoint(db, "nfts:applied"),
    refreshedAt: checkpoint(db, "market:refreshed"),
    salesFrom: sales.first,
    salesTo: sales.last,
    salesCount: sales.n,
  };
}

const num = v => {
  const n = Number(v);
  return v === undefined || v === "" || !Number.isFinite(n) ? null : n;
};

// GET /api/upland/market/summary -> categories with counts, and how fresh the data is
marketRouter.get("/summary", (_req, res) => {
  const db = indexerDb();
  if (!db) return res.status(503).json(NO_DATA);
  const categories = db.prepare(`SELECT category, COUNT(*) AS designs, SUM(listed) AS listed, SUM(escrow) AS escrow,
      SUM(sales_30d) AS sales30d FROM market_designs GROUP BY category ORDER BY designs DESC`).all()
    .map(c => ({ ...c, label: CATEGORY_LABELS[c.category] || c.category }));
  res.json({ categories, ...freshness(db) });
});

// GET /api/upland/market/assets?category=&q=&listed=1&minPrice=&maxPrice=&sort=listed&page=1&pageSize=100
marketRouter.get("/assets", (req, res) => {
  const db = indexerDb();
  if (!db) return res.status(503).json(NO_DATA);
  const where = [];
  const args = [];
  if (req.query.category) {
    where.push("category = ?");
    args.push(String(req.query.category));
  }
  const q = String(req.query.q || "").trim();
  if (q) {
    where.push("(display_name LIKE ? ESCAPE '\\' OR token_name = ?)");
    args.push(`%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`, q.toLowerCase());
  }
  if (req.query.listed === "1") where.push("listed > 0");
  const minPrice = num(req.query.minPrice);
  const maxPrice = num(req.query.maxPrice);
  if (minPrice !== null) {
    where.push(`${PRICE} >= ?`);
    args.push(minPrice);
  }
  if (maxPrice !== null) {
    where.push(`${PRICE} <= ?`);
    args.push(maxPrice);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sort = SORTS[req.query.sort] ? String(req.query.sort) : "listed";
  const pageSize = Math.min(Math.max(Math.trunc(num(req.query.pageSize) ?? 100), 10), 500);
  const page = Math.max(Math.trunc(num(req.query.page) ?? 1), 1);

  const total = db.prepare(`SELECT COUNT(*) AS n FROM market_designs ${clause}`).get(...args).n;
  const assets = db.prepare(`SELECT category, token_name, display_name, issued, max_supply, escrow, listed, last_price,
      last_sale_at, sales_7d, sales_30d, median_30d, low_30d, high_30d, floor_30d, image_url
    FROM market_designs ${clause} ORDER BY ${SORTS[sort]}, token_name LIMIT ? OFFSET ?`)
    .all(...args, pageSize, (page - 1) * pageSize)
    .map(a => ({ ...a, categoryLabel: CATEGORY_LABELS[a.category] || a.category }));
  res.json({ total, page, pageSize, sort, assets, ...freshness(db) });
});

/** Daily OHLC candles from sales (UTC days), oldest first. */
function dailyCandles(sales) {
  const days = new Map();
  for (const s of [...sales].sort((a, b) => (a.ts < b.ts ? -1 : 1))) {
    const day = s.ts.slice(0, 10);
    const c = days.get(day);
    if (!c) days.set(day, { day, open: s.price, high: s.price, low: s.price, close: s.price, volume: 1 });
    else {
      c.high = Math.max(c.high, s.price);
      c.low = Math.min(c.low, s.price);
      c.close = s.price;
      c.volume++;
    }
  }
  return [...days.values()];
}

// GET /api/upland/market/asset/:category/:token -> one design: what's in escrow, and its sales
marketRouter.get("/asset/:category/:token", (req, res) => {
  const db = indexerDb();
  if (!db) return res.status(503).json(NO_DATA);
  const { category, token } = req.params;
  const design = db.prepare("SELECT * FROM market_designs WHERE category = ? AND token_name = ?").get(category, token);
  if (!design) return res.status(404).json({ error: "No such map asset design" });

  // Each NFT in escrow with its latest escrow move: a listing (and by whom,
  // since when), placed on a property that went up for sale (a bundle), some
  // other move, or nothing on record (before our history).
  const inEscrow = db.prepare(`
    WITH esc AS (SELECT id, serial FROM nft_items WHERE category = ? AND token_name = ? AND in_escrow = 1),
    ev AS (
      SELECT e.dgood_id, e.ts, e.account, e.kind, e.direction, e.property_id,
        ROW_NUMBER() OVER (PARTITION BY e.dgood_id ORDER BY e.block_num DESC, e.global_sequence DESC) AS rn
      FROM nft_escrow_events e JOIN esc ON esc.id = e.dgood_id)
    SELECT esc.id, esc.serial, ev.ts AS since, ev.account AS seller, ev.kind, ev.property_id AS propertyId,
      p.address, p.city_name AS city
    FROM esc LEFT JOIN ev ON ev.dgood_id = esc.id AND ev.rn = 1 AND ev.direction = 'in'
    LEFT JOIN properties p ON p.id = ev.property_id
    ORDER BY ev.kind = 'listing' DESC, ev.ts DESC, esc.serial`).all(category, token);

  const sales = db.prepare(`SELECT ts, price, buyer_paid AS buyerPaid, mint AS serial FROM nft_sales
    WHERE dg_category = ? AND dg_token = ? AND price IS NOT NULL ORDER BY ts DESC`).all(category, token);
  // 1 UPX is a giveaway price, never a market price (see indexer/nfts.js), so the
  // chart and the stats leave those out; the sales list still shows them.
  const real = sales.filter(s => s.price > 1);
  const stats = Object.fromEntries([7, 30, 90].map(days => {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const xs = real.filter(s => s.ts >= since).map(s => s.price);
    return [days, xs.length
      ? { trades: xs.length, avg: Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100, min: Math.min(...xs), max: Math.max(...xs) }
      : { trades: 0 }];
  }));

  res.json({
    design: { ...design, categoryLabel: CATEGORY_LABELS[design.category] || design.category },
    listed: inEscrow.filter(i => i.kind === "listing"),
    otherEscrow: inEscrow.filter(i => i.kind !== "listing"),
    sales: sales.slice(0, 300),
    candles: dailyCandles(real),
    stats,
    giveaways: sales.length - real.length,
    ...freshness(db),
  });
});

module.exports = marketRouter;
module.exports.CATEGORY_LABELS = CATEGORY_LABELS;

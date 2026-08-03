const mapAssetsRouter = require("express").Router();
const { getActions } = require("../../utils/appchainClient");

const CATEGORY_LABEL_RE = /(Outdoor Decor|Decoration|Uppie|Structure Ornament|Seed|Vehicle)\s+NFT/i;
const CATEGORY_MAP = {
  "outdoor decor":      "outdoordecor",
  "decoration":         "outdoordecor",
  "uppie":              "uppie",
  "structure ornament": "structornmt",
  "seed":               "seeds",
  "vehicle":            "vehicle",
};

function parseMemo(memo) {
  if (!memo) return {};
  const nameM    = memo.match(/NFT "([^"]+)"/);
  const mintM    = memo.match(/\bmint (\d+)/);
  const idM      = memo.match(/NFT ID: (\d+)/);
  const ipfsM    = memo.match(/meta data:.*?([A-Za-z0-9]{20,})/);
  const catM     = memo.match(CATEGORY_LABEL_RE);
  const userM    = memo.match(/Upland user ([^\s]+) with/);
  const isSecondary = /is now the owner/.test(memo);

  let category = null;
  if (catM) category = CATEGORY_MAP[catM[1].toLowerCase()] || catM[1].toLowerCase();

  return {
    displayName:  nameM ? nameM[1] : null,
    mint:         mintM ? Number(mintM[1]) : null,
    nftId:        idM   ? idM[1]   : null,
    ipfsCid:      ipfsM ? ipfsM[1].slice(0, 59) : null,
    uplandUser:   userM ? userM[1] : null,
    category,
    type: isSecondary ? "sale" : "mint",
  };
}

// GET /api/upland/map-assets/activity?category=&limit=&type=
mapAssetsRouter.get("/activity", async (req, res) => {
  const limit     = Math.min(Number(req.query.limit) || 50, 200);
  const catFilter  = req.query.category || null;
  const typeFilter = req.query.type || null;

  let issueRes, transferRes, n44Res, n112Res;
  try {
    [issueRes, transferRes, n44Res, n112Res] = await Promise.all([
      typeFilter === "sale" ? { actions: [] }
        : getActions({ filter: "uplandnftact:issue",       limit, sort: "desc" }),
      typeFilter === "mint" ? { actions: [] }
        : getActions({ filter: "uplandnftact:transfernft", limit, sort: "desc" }),
      getActions({ filter: "playuplandme:n44",              limit, sort: "desc" }),
      typeFilter === "mint" ? { actions: [] }
        : getActions({ filter: "playuplandme:n112",        limit, sort: "desc" }),
    ]);
  } catch (err) {
    return res.status(502).json({ count: 0, events: [], error: err.message });
  }

  // trxId → priceUpx: n112 = escrow resolve (p141 = buyer's total payment = sale price)
  const priceByTrx = {};
  for (const a of n112Res.actions || []) {
    const data  = a.act?.data || {};
    const price = parseFloat((data.p141 || "0 UPX").split(" ")[0]) || 0;
    if (price) priceByTrx[a.trx_id] = price;
  }

  // blockNum → priceUpx: n44 = native in-game buy-now
  const priceByBlock = {};
  for (const a of n44Res.actions || []) {
    const data  = a.act?.data || {};
    const price = parseFloat((data.p45 || "0 UPX").split(" ")[0]) || null;
    if (price) priceByBlock[a.block_num] = price;
  }

  const events = [];

  // Primary mints from issue
  for (const a of issueRes.actions || []) {
    const data     = a.act?.data || {};
    const category = data.category || null;
    if (catFilter && category !== catFilter) continue;

    const parsed = parseMemo(data.memo || "");
    events.push({
      nftId:       (data.dgood_ids?.[0] ?? null),
      displayName: parsed.displayName,
      category,
      mint:        parsed.mint,
      type:        "mint",
      buyerEos:    data.to,
      uplandUser:  parsed.uplandUser,
      timestamp:   a["@timestamp"] || a.timestamp,
      priceUpx:    null,
      ipfsCid:     parsed.ipfsCid,
      blockNum:    a.block_num,
      trxId:       a.trx_id,
    });
  }

  // Secondary sales from transfernft
  for (const a of transferRes.actions || []) {
    const data = a.act?.data || {};
    if (data.from !== "playuplandme") continue;
    const memo = data.memo || "";
    if (!/is now the owner/.test(memo)) continue;

    const parsed = parseMemo(memo);
    if (catFilter && parsed.category !== catFilter) continue;
    if (!parsed.displayName && !(data.dgood_ids?.[0])) continue;

    events.push({
      nftId:       parsed.nftId || (data.dgood_ids?.[0] ?? null),
      displayName: parsed.displayName,
      category:    parsed.category,
      mint:        parsed.mint,
      type:        "sale",
      buyerEos:    data.to,
      uplandUser:  parsed.uplandUser,
      timestamp:   a["@timestamp"] || a.timestamp,
      priceUpx:    priceByTrx[a.trx_id] || priceByBlock[a.block_num] || null,
      ipfsCid:     parsed.ipfsCid,
      blockNum:    a.block_num,
      trxId:       a.trx_id,
    });
  }

  events.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
  res.json({ count: events.length, events });
});

// GET /api/upland/map-assets/listings?limit=
mapAssetsRouter.get("/listings", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);

  let result;
  try {
    result = await getActions({ filter: "playuplandme:n12", limit, sort: "desc" });
  } catch (err) {
    return res.status(502).json({ count: 0, listings: [], error: err.message });
  }

  const listings = [];
  for (const a of result.actions || []) {
    const data = a.act?.data || {};
    const p21  = data.p21 || [];
    if (p21[0] !== "asset") continue;

    const priceUpx = parseFloat((p21[1] || "0 UPX").split(" ")[0]) || null;
    listings.push({
      nftId:     String(data.p15 || ""),
      sellerEos: data.p23 || "",
      priceUpx,
      timestamp: a["@timestamp"] || a.timestamp,
      trxId:     a.trx_id,
    });
  }

  res.json({ count: listings.length, listings });
});

// Price history cache: key -> { data, expiresAt }
const priceCache = new Map();

// GET /api/upland/map-assets/price-history?name=<NFT type>&days=30&period=day
mapAssetsRouter.get("/price-history", async (req, res) => {
  const name   = (req.query.name || "").trim();
  const days   = Math.min(Number(req.query.days) || 30, 90);
  const period = req.query.period === "week" ? "week" : "day";

  if (!name) return res.status(400).json({ error: "name parameter required" });

  const cacheKey = `${name}:${days}:${period}`;
  const hit = priceCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return res.json(hit.data);

  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

  // Fetch price lookup maps for the entire window upfront (parallel)
  let n112Res, n44Res;
  try {
    [n112Res, n44Res] = await Promise.all([
      getActions({ filter: "playuplandme:n112", limit: 200, sort: "desc", after: cutoff }),
      getActions({ filter: "playuplandme:n44",  limit: 200, sort: "desc", after: cutoff }),
    ]);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }

  const priceByTrx = {};
  for (const a of n112Res.actions || []) {
    const d = a.act?.data || {};
    const p = parseFloat((d.p141 || "0 UPX").split(" ")[0]) || 0;
    if (p) priceByTrx[a.trx_id] = p;
  }
  const priceByBlock = {};
  for (const a of n44Res.actions || []) {
    const d = a.act?.data || {};
    const p = parseFloat((d.p45 || "0 UPX").split(" ")[0]) || null;
    if (p) priceByBlock[a.block_num] = p;
  }

  // Parallel-fetch up to MAX_PAGES of transfernft events in the window
  const MAX_PAGES = 10;
  const pages = await Promise.allSettled(
    Array.from({ length: MAX_PAGES }, (_, page) =>
      getActions({
        filter: "uplandnftact:transfernft",
        limit:  200,
        sort:   "desc",
        after:  cutoff,
        skip:   page * 200,
      })
    )
  );

  const sales = [];
  for (const result of pages) {
    if (result.status !== "fulfilled") continue;
    for (const a of result.value.actions || []) {
      const ts   = a["@timestamp"] || a.timestamp || "";
      const data = a.act?.data || {};
      if (data.from !== "playuplandme") continue;
      const memo = data.memo || "";
      if (!/is now the owner/.test(memo)) continue;

      const nameM = memo.match(/NFT "([^"]+)"/);
      if (!nameM || nameM[1] !== name) continue;

      const price = priceByTrx[a.trx_id] || priceByBlock[a.block_num] || null;
      if (!price) continue;

      sales.push({ ts, price });
    }
  }

  // Build OHLC buckets (sales are newest-first from the API)
  const buckets = new Map();

  for (const { ts, price } of sales) {
    const d = new Date(ts);
    let bucket;
    if (period === "week") {
      const dow = d.getDay() || 7;
      const mon = new Date(d.getTime() - (dow - 1) * 86_400_000);
      bucket = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, "0")}-${String(mon.getDate()).padStart(2, "0")}`;
    } else {
      bucket = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(price);
  }

  // prices per bucket are newest-first → [0]=close, [last]=open
  const candles = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, prices]) => ({
      time,
      open:   prices[prices.length - 1],
      high:   Math.max(...prices),
      low:    Math.min(...prices),
      close:  prices[0],
      volume: prices.length,
    }));

  const allPrices = sales.map(s => s.price);
  const avg = allPrices.length
    ? Math.round(allPrices.reduce((a, b) => a + b, 0) / allPrices.length)
    : null;

  const result = {
    name,
    candles,
    avg,
    min: allPrices.length ? Math.min(...allPrices) : null,
    max: allPrices.length ? Math.max(...allPrices) : null,
    totalSales: allPrices.length,
  };

  priceCache.set(cacheKey, { data: result, expiresAt: Date.now() + 5 * 60_000 });
  res.json(result);
});

// Market overview cache
let overviewCache = null;

// GET /api/upland/map-assets/market-overview
mapAssetsRouter.get("/market-overview", async (req, res) => {
  if (overviewCache && overviewCache.expiresAt > Date.now()) {
    return res.json(overviewCache.data);
  }

  const now          = new Date();
  const todayStart   = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  try {
    const [issueData, transferData, n112Data, listingsData] = await Promise.all([
      getActions({ filter: "uplandnftact:issue",       limit: 200, sort: "desc", after: todayStart }),
      getActions({ filter: "uplandnftact:transfernft", limit: 200, sort: "desc", after: sevenDaysAgo }),
      getActions({ filter: "playuplandme:n112",        limit: 200, sort: "desc", after: sevenDaysAgo }),
      getActions({ filter: "playuplandme:n12",         limit: 200, sort: "desc" }),
    ]);

    const mintsToday = (issueData.actions || []).length;

    const priceByTrx = {};
    for (const a of n112Data.actions || []) {
      const d = a.act?.data || {};
      const p = parseFloat((d.p141 || "0 UPX").split(" ")[0]) || 0;
      if (p) priceByTrx[a.trx_id] = p;
    }

    let salesToday = 0;
    const recentPrices = [];

    for (const a of transferData.actions || []) {
      const ts   = a["@timestamp"] || a.timestamp || "";
      const data = a.act?.data || {};
      if (data.from !== "playuplandme") continue;
      if (!/is now the owner/.test(data.memo || "")) continue;

      const price = priceByTrx[a.trx_id];
      if (price) recentPrices.push(price);
      if (ts >= todayStart) salesToday++;
    }

    const avgPriceUpx = recentPrices.length
      ? Math.round(recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length)
      : null;

    const activeListings = (listingsData.actions || []).filter(a => {
      const p21 = a.act?.data?.p21 || [];
      return p21[0] === "asset";
    }).length;

    const data = { mintsToday, salesToday, avgPriceUpx, activeListings };
    overviewCache = { data, expiresAt: Date.now() + 3 * 60_000 };
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = mapAssetsRouter;

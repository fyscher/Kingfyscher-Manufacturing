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
// Sources:
//   mints → uplandnftact:issue  (has explicit category field + memo with NFT name)
//   sales → uplandnftact:transfernft "is now the owner" (secondary market)
// Price on sales → correlate with playuplandme:n44 by block_num
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

  // trxId → priceUpx: n112 = escrow resolve (p141=seller payout, p142=fee; sum = sale price)
  const priceByTrx = {};
  for (const a of n112Res.actions || []) {
    const data   = a.act?.data || {};
    const payout = parseFloat((data.p141 || "0 UPX").split(" ")[0]) || 0;
    const fee    = parseFloat((data.p142 || "0 UPX").split(" ")[0]) || 0;
    if (payout) priceByTrx[a.trx_id] = payout + fee;
  }

  // blockNum → priceUpx: n44 = native in-game buy-now (less common for map assets)
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

  // Newest first
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
    if (p21[0] !== "asset") continue; // skip SPARKLT-priced listings

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

module.exports = mapAssetsRouter;

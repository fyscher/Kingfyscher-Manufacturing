const structuresRouter = require("express").Router();
const { uplandFetch } = require("../../utils/uplandClient");
const { getActions } = require("../../utils/appchainClient");

const PERIODS = [
  { id: "24h", name: "Last 24 Hours",  hours: 24 },
  { id: "7d",  name: "Last 7 Days",    hours: 24 * 7 },
  { id: "30d", name: "Last 30 Days",   hours: 24 * 30 },
];

// GET /api/upland/structures/types
// Returns time-period options for the market filter
// (Upland /buildings endpoint has a server-side SRID bug; /building-types returns 404)
structuresRouter.get("/types", (_req, res) => {
  res.json({ types: PERIODS.map(p => ({ id: p.id, name: p.name })) });
});

// GET /api/upland/structures/market?buildingTypeId=7d&cityId=1
// Returns recent n41 property purchases from Appchain within the chosen period,
// enriched with address/city from the Developers API, optionally filtered by city.
structuresRouter.get("/market", async (req, res) => {
  const { buildingTypeId = "7d", cityId } = req.query;
  const period = PERIODS.find(p => p.id === buildingTypeId) || PERIODS[1];
  const after = new Date(Date.now() - period.hours * 3600 * 1000).toISOString();

  const result = await getActions({
    filter: "playuplandme:n41",
    limit: 100,
    sort: "desc",
    after,
  });

  const raw = (result.actions || []).map(action => {
    const data = action.act?.data || {};
    return {
      trxId:       action.trx_id,
      propertyId:  String(data.a45 || ""),
      buyerEos:    data.p51 || "",
      priceUpx:    parseFloat(data.p54 || "") || 0,
      purchasedAt: action["@timestamp"] || action.timestamp,
    };
  });

  // Enrich up to 20 unique properties with address/city
  const seen = new Set();
  const toEnrich = [];
  for (const p of raw) {
    if (p.propertyId && !seen.has(p.propertyId)) {
      seen.add(p.propertyId);
      toEnrich.push(p.propertyId);
      if (toEnrich.length >= 20) break;
    }
  }

  const propMap = {};
  await Promise.all(
    toEnrich.map(async id => {
      try {
        propMap[id] = await uplandFetch(`/properties/${id}`);
      } catch { /* skip — property detail is optional */ }
    })
  );

  let listings = raw.map(p => {
    const prop = propMap[p.propertyId];
    return {
      ...p,
      type:  { name: "Property" },
      city:  prop?.city  || null,
      owner: p.buyerEos,
      price: p.priceUpx,
      address:      prop?.address      || null,
      neighborhood: prop?.neighborhood || null,
    };
  });

  if (cityId) {
    listings = listings.filter(l => String(l.city?.id) === String(cityId));
  }

  listings.sort((a, b) => a.price - b.price);

  res.json({
    floor:    listings.length > 0 ? listings[0].price : null,
    count:    listings.length,
    total:    result.total?.value ?? listings.length,
    listings,
  });
});

// GET /api/upland/structures/sales-history?limit=20
// Returns recent property purchases from Appchain (n41 actions)
structuresRouter.get("/sales-history", async (req, res) => {
  const { limit = 20, before, after } = req.query;
  try {
    const result = await getActions({
      filter: "playuplandme:n41",
      limit:  Math.min(Number(limit), 100),
      sort:   "desc",
      before,
      after,
    });
    const sales = (result.actions || []).map(action => {
      const data = action.act?.data || {};
      return {
        trxId:       action.trx_id,
        blockNum:    action.block_num,
        timestamp:   action["@timestamp"] || action.timestamp,
        priceUpx:    parseFloat(data.p54 || "") || null,
        propertyId:  String(data.a45 || ""),
        buyerEos:    data.p51 || "",
      };
    });
    res.json({ total: result.total?.value ?? sales.length, sales });
  } catch (err) {
    res.json({ total: 0, sales: [], error: err.message });
  }
});

module.exports = structuresRouter;

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
// Returns recent n5 property ownership notarizations from Appchain within the chosen
// period (actual sale prices), enriched with address/city, optionally filtered by city.
structuresRouter.get("/market", async (req, res) => {
  const { buildingTypeId = "7d", cityId } = req.query;
  const period = PERIODS.find(p => p.id === buildingTypeId) || PERIODS[1];
  const after = new Date(Date.now() - period.hours * 3600 * 1000).toISOString();

  const result = await getActions({
    filter: "playuplandme:n5",
    limit: 100,
    sort: "desc",
    after,
  });

  const raw = (result.actions || []).map(action => {
    const data = action.act?.data || {};
    const addrMatch = (data.memo || "").match(/owns (.+?) on Upland/);
    return {
      trxId:       action.trx_id,
      propertyId:  String(data.a45 || ""),
      buyerEos:    data.p14 || "",
      priceUpx:    parseFloat((data.p24 || "0 UPX").split(" ")[0]) || 0,
      purchasedAt: action["@timestamp"] || action.timestamp,
      address:     addrMatch ? addrMatch[1] : null,
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
      type:         { name: "Property" },
      city:         prop?.city         || null,
      owner:        p.buyerEos,
      price:        p.priceUpx,
      address:      p.address || prop?.address || null,
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
// Returns recent property ownership changes from Appchain (n5 notarization actions)
structuresRouter.get("/sales-history", async (req, res) => {
  const { limit = 20, before, after } = req.query;
  try {
    const result = await getActions({
      filter: "playuplandme:n5",
      limit:  Math.min(Number(limit), 100),
      sort:   "desc",
      before,
      after,
    });
    const sales = (result.actions || []).map(action => {
      const data = action.act?.data || {};
      const addrMatch = (data.memo || "").match(/owns (.+?) on Upland/);
      return {
        trxId:       action.trx_id,
        blockNum:    action.block_num,
        timestamp:   action["@timestamp"] || action.timestamp,
        priceUpx:    parseFloat((data.p24 || "0 UPX").split(" ")[0]) || null,
        propertyId:  String(data.a45 || ""),
        buyerEos:    data.p14 || "",
        address:     addrMatch ? addrMatch[1] : null,
      };
    });
    res.json({ total: result.total?.value ?? sales.length, sales });
  } catch (err) {
    res.json({ total: 0, sales: [], error: err.message });
  }
});

// GET /api/upland/structures/building-search?cityId=&address=
// Searches Upland properties by address, then enriches each result with the most
// recent n5 on-chain sale price by scanning recent chain history.
structuresRouter.get("/building-search", async (req, res) => {
  const { cityId, address } = req.query;
  if (!address || !address.trim()) return res.json({ properties: [] });

  const params = new URLSearchParams({ currentPage: 1, pageSize: 50 });
  if (cityId) params.set("cityId", cityId);
  params.set("textSearch", address.trim());

  let properties = [];
  try {
    const propData = await uplandFetch(`/properties?${params}`);
    properties = propData.results || [];
  } catch {
    return res.json({ properties: [] });
  }

  if (properties.length === 0) return res.json({ properties: [] });

  const propertyIds = new Set(properties.map(p => String(p.id)));
  const salesMap = {};

  // Scan recent n5 actions in batches to build a last-sale map for the matched IDs
  let before;
  for (let batch = 0; batch < 5; batch++) {
    let result;
    try {
      result = await getActions({ filter: "playuplandme:n5", limit: 100, sort: "desc", before });
    } catch { break; }

    const actions = result.actions || [];
    if (actions.length === 0) break;

    for (const action of actions) {
      const data = action.act?.data || {};
      const pid = String(data.a45 || "");
      if (propertyIds.has(pid) && !salesMap[pid]) {
        const addrMatch = (data.memo || "").match(/owns (.+?) on Upland/);
        salesMap[pid] = {
          priceUpx:  parseFloat((data.p24 || "0 UPX").split(" ")[0]) || null,
          timestamp: action["@timestamp"] || action.timestamp,
          buyerEos:  data.p14 || "",
          address:   addrMatch ? addrMatch[1] : null,
        };
      }
    }

    if (Object.keys(salesMap).length >= propertyIds.size) break;
    before = actions[actions.length - 1]?.["@timestamp"];
  }

  const enriched = properties.map(p => ({
    id:           p.id,
    address:      p.address,
    city:         p.city,
    neighborhood: p.neighborhood,
    status:       p.status,
    currentPrice: p.mintPrice || null,
    lastSale:     salesMap[String(p.id)] || null,
  }));

  res.json({ properties: enriched });
});

module.exports = structuresRouter;

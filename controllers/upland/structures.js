const structuresRouter = require("express").Router();
const { indexerDb } = require("../../utils/indexerDb");

// Building Browser: which properties have a given building, from the indexer's
// copy of the chain table that places each structure NFT on a property (a21;
// see indexer/buildings.js). Upland's own POST /buildings search is broken
// server-side, and the old address search here could never match a building.
const NO_BUILDINGS = {
  error: "Building data isn't available on this server: it needs the indexer database (run `npm run indexer -- buildings` and `-- nfts --add structure`).",
};
const buildingsDb = () => {
  const db = indexerDb();
  return db && db.prepare("SELECT 1 FROM sync_state WHERE feed = 'snapshot:buildings'").get() ? db : null;
};
const cityFilter = cityId => (Number.isInteger(cityId) && cityId > 0 ? cityId : null);

// GET /api/upland/structures/building-types?cityId=  -> the dropdown: each building
// with how many stand in the city (or everywhere), how many are on properties for
// sale, and the cheapest UPX ask among those. Read from building_types, which the
// indexer's tail rebuilds every 15 minutes.
structuresRouter.get("/building-types", (req, res) => {
  const db = buildingsDb();
  if (!db) return res.status(503).json(NO_BUILDINGS);
  const cityId = cityFilter(Number(req.query.cityId));
  const types = db.prepare(`
    SELECT token_name AS type, MIN(name) AS name, SUM(buildings) AS buildings, SUM(under_construction) AS underConstruction,
      SUM(properties) AS properties, SUM(for_sale) AS forSale, MIN(cheapest_upx) AS cheapestUpx
    FROM building_types ${cityId ? "WHERE city_id = @cityId" : ""}
    GROUP BY token_name
    ORDER BY name COLLATE NOCASE`).all(cityId ? { cityId } : {});
  const mark = key => db.prepare("SELECT done_until FROM sync_state WHERE feed = ?").get(key)?.done_until ?? null;
  res.json({ types, unidentified: Number(mark("buildings:unidentified") || 0), asOf: mark("buildings:refreshed") });
});

// GET /api/upland/structures/buildings?type=smltownhouse&cityId=1&forSale=1&single=1  -> the
// properties with that building, the ones for sale first (cheapest UPX ask first).
// single=1 keeps to properties where it's the only building: a parcel holding 20
// buildings is listed at the parcel's price, not one building's. Buildings still
// under construction are left out unless unfinished=1 (then flagged, with the
// expected finish). Index lookups on each building's own type and city (see
// indexer enrichBuildings).
structuresRouter.get("/buildings", (req, res) => {
  const db = buildingsDb();
  if (!db) return res.status(503).json(NO_BUILDINGS);
  const type = String(req.query.type || "");
  if (!type) return res.status(400).json({ error: "Pick a building" });
  const cityId = cityFilter(Number(req.query.cityId));
  const where = `WHERE b.token_name = @type
      ${cityId ? "AND b.city_id = @cityId" : ""}
      ${req.query.forSale === "1" ? "AND l.property_id IS NOT NULL" : ""}
      ${req.query.single === "1" ? "AND b.on_property <= 1" : ""}
      ${req.query.unfinished === "1" ? "" : "AND b.under_construction = 0"}`;
  const args = cityId ? { type, cityId } : { type };
  // A parcel with two of the same building appears once.
  const properties = db.prepare(`
    SELECT b.property_id AS id, p.address, p.city_name AS city, p.neighborhood_name AS neighborhood,
      p.mint_price AS mintPrice, l.price_upx AS priceUpx, l.price_fiat AS priceUsd, MAX(b.on_property) AS buildingsOnProperty,
      MAX(b.under_construction) AS underConstruction, MIN(k.eta) AS finishesAround
    FROM property_buildings b
    LEFT JOIN properties p ON p.id = b.property_id
    LEFT JOIN listings_current l ON l.property_id = b.property_id
    LEFT JOIN constructions k ON k.nft_id = b.nft_id
    ${where}
    GROUP BY b.property_id
    ORDER BY l.property_id IS NULL, NULLIF(l.price_upx, 0) IS NULL, l.price_upx, l.price_fiat, p.address
    LIMIT 1000`).all(args);
  const total = db.prepare(`SELECT COUNT(DISTINCT b.property_id) AS n FROM property_buildings b
    LEFT JOIN listings_current l ON l.property_id = b.property_id ${where}`).get(args).n;
  res.json({ type, properties, total });
});

// GET /api/upland/structures/building-sales?type=smltownhouse&limit=10  -> the latest
// property sales, across every city, that say what this building sells for: the
// property's only building is this one, and the sale came after it was built
// (from its BUILD payment; none means it predates the stored history). Sales of
// multi-building parcels are counted and left out, and so are 1-UPX "sales"
// (transfers between a player's own accounts). Plus what's listed now, to compare.
structuresRouter.get("/building-sales", (req, res) => {
  const db = buildingsDb();
  if (!db) return res.status(503).json(NO_BUILDINGS);
  const type = String(req.query.type || "");
  if (!type) return res.status(400).json({ error: "Pick a building" });
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 10, 1), 50);
  const sales = db.prepare(`
    SELECT s.ts, s.price, s.kind, b.property_id AS id, COALESCE(p.address, s.address) AS address,
      p.city_name AS city, p.neighborhood_name AS neighborhood
    FROM property_buildings b
    CROSS JOIN property_sales s ON s.property_id = b.property_id
    LEFT JOIN properties p ON p.id = b.property_id
    WHERE b.token_name = @type AND b.on_property = 1 AND b.under_construction = 0
      AND (b.built_at IS NULL OR s.ts >= b.built_at)
      AND s.price > CASE s.kind WHEN 'upx' THEN 1 ELSE 0 END
    ORDER BY s.ts DESC
    LIMIT @limit`).all({ type, limit });
  const leftOut = db.prepare(`SELECT
      COUNT(DISTINCT CASE WHEN b.on_property > 1 THEN s.global_sequence END) AS parcels,
      COUNT(DISTINCT CASE WHEN b.on_property = 1 AND b.under_construction = 0 AND s.ts < b.built_at THEN s.global_sequence END) AS beforeBuilt,
      COUNT(DISTINCT CASE WHEN b.under_construction = 1 THEN s.global_sequence END) AS unfinished
    FROM property_buildings b CROSS JOIN property_sales s ON s.property_id = b.property_id
    WHERE b.token_name = @type AND s.price > CASE s.kind WHEN 'upx' THEN 1 ELSE 0 END`).get({ type });
  const listed = db.prepare(`SELECT SUM(for_sale) AS forSale, MIN(cheapest_upx) AS cheapestUpx
    FROM building_types WHERE token_name = @type`).get({ type });
  const history = db.prepare("SELECT MIN(ts) AS since FROM property_sales").get();
  res.json({ type, sales, leftOut, listedNow: { forSale: listed.forSale || 0, cheapestUpx: listed.cheapestUpx ?? null }, salesSince: history.since });
});

module.exports = structuresRouter;

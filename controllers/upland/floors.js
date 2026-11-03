const floorsRouter = require("express").Router();
const { indexerDb } = require("../../utils/indexerDb");
const { computeFloors } = require("../../indexer/floors");

const NO_DATA = {
  error: "Floor data isn't available on this server: it needs the indexer database (run `npm run indexer -- listings` and `-- properties`).",
};

// GET /api/upland/floors/cities -> cities that have catalogued properties, for the picker
floorsRouter.get("/cities", (_req, res) => {
  const db = indexerDb();
  if (!db) return res.status(503).json(NO_DATA);
  const cities = db.prepare(`
    SELECT city_id AS id, city_name AS name, COUNT(*) AS listings
    FROM listings_current WHERE city_id IS NOT NULL GROUP BY city_id ORDER BY city_name`).all();
  res.json({ cities });
});

// GET /api/upland/floors?cities=1,3,12&top=25  (no cities = all of Upland)
floorsRouter.get("/", (req, res) => {
  const db = indexerDb();
  if (!db) return res.status(503).json(NO_DATA);
  const cityIds = String(req.query.cities || "")
    .split(",")
    .map(Number)
    .filter(n => Number.isInteger(n) && n > 0);
  const top = Math.min(Math.max(Number(req.query.top) || 25, 1), 200);
  res.json(computeFloors(db, { cityIds, top }));
});

module.exports = floorsRouter;

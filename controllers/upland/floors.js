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

// GET /api/upland/floors?cities=1,3,12&top=25  (just those cities)
// GET /api/upland/floors?exclude=92,141&top=25   (all of Upland except those)
// Neither = all of Upland; cities wins if both are sent.
const idList = v => String(v || "").split(",").map(Number).filter(n => Number.isInteger(n) && n > 0);
floorsRouter.get("/", (req, res) => {
  const db = indexerDb();
  if (!db) return res.status(503).json(NO_DATA);
  const cityIds = idList(req.query.cities);
  const excludeIds = cityIds.length ? [] : idList(req.query.exclude);
  const top = Math.min(Math.max(Number(req.query.top) || 25, 1), 200);
  res.json(computeFloors(db, { cityIds, excludeIds, top }));
});

module.exports = floorsRouter;

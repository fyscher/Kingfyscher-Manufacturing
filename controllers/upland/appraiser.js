// Property appraiser and solo build calculator, read from the indexer database.
// The valuation itself lives in indexer/appraisal.js (land from neighborhood
// comps, buildings from what buyers paid over the land, map assets from their
// own resales); this file only finds properties and serves the results.
const appraiserRouter = require("express").Router();
const { indexerDb } = require("../../utils/indexerDb");
const { userExtractor } = require("../../middleware");
const { appraiseProperty } = require("../../indexer/appraisal");

// Signed-in only: a personal tool, like the map asset pages.
appraiserRouter.use(userExtractor);

const NO_DATA = {
  error: "Appraisal data isn't available on this server: it needs the indexer database (run `npm run indexer -- neighborhoods`, then `-- appraisal --bundles`).",
};
const appraisalDb = () => {
  const db = indexerDb();
  return db && db.prepare("SELECT 1 FROM appraisal_stats WHERE key = 'summary'").get() ? db : null;
};

// GET /api/upland/appraiser/search?q=131 franklin&cityId=1 -> up to 20 properties whose
// address starts with q (Upland's addresses are upper case), or the one with that id.
appraiserRouter.get("/search", (req, res) => {
  const db = appraisalDb();
  if (!db) return res.status(503).json(NO_DATA);
  const q = String(req.query.q || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (q.length < 3) return res.json({ results: [] });
  const cityId = Number(req.query.cityId);
  const cols = "id, address, city_name AS city, neighborhood_name AS neighborhood, mint_price AS mint";
  const results = /^\d{6,}$/.test(q)
    ? db.prepare(`SELECT ${cols} FROM properties WHERE id = ?`).all(q)
    : db.prepare(`SELECT ${cols} FROM properties WHERE address >= @q AND address < @hi
        ${Number.isInteger(cityId) && cityId > 0 ? "AND city_id = @cityId" : ""} ORDER BY address LIMIT 20`)
      .all({ q, hi: `${q}￿`, cityId });
  res.json({ results });
});

// "outdoordecor/bench*2,landvehicle/car" -> [{category, token, count}]
function parsePicks(raw) {
  return String(raw || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 50).map(s => {
    const [design, n] = s.split("*");
    const [category, token] = design.split("/");
    return { category, token, count: Math.min(Math.max(Number(n) || 1, 1), 999) };
  }).filter(p => p.category && p.token);
}

// GET /api/upland/appraiser/property/:id?picks=outdoordecor/bench*2 -> the appraisal
appraiserRouter.get("/property/:id", (req, res) => {
  const db = appraisalDb();
  if (!db) return res.status(503).json(NO_DATA);
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: "A property id is all digits" });
  const result = appraiseProperty(db, req.params.id, { picks: parsePicks(req.query.picks) });
  if (!result) return res.status(404).json({ error: "No such property in the catalog or the sales history" });
  res.json(result);
});

// GET /api/upland/appraiser/build-rules -> every building type someone started in the last
// 90 days (its rules from the latest BUILD payment), with what buyers pay for one over the land.
appraiserRouter.get("/build-rules", (_req, res) => {
  const db = appraisalDb();
  if (!db) return res.status(503).json(NO_DATA);
  const types = db.prepare(`SELECT token_name AS token, COALESCE(name, token_name) AS name, sales, median, p25, p75, ci_low AS ciLow, ci_high AS ciHigh,
      pairs, pair_median AS pairMedian, hours_needed AS hoursNeeded, min_stake AS minStake, max_stake AS maxStake,
      builds_90d AS builds90d, contracts_90d AS contracts90d, contract_n AS contractN, contract_median AS contractMedian
    FROM building_values WHERE hours_needed IS NOT NULL AND builds_90d > 0 ORDER BY builds_90d DESC, sales DESC`).all();
  const stats = db.prepare("SELECT value, refreshed_at FROM appraisal_stats WHERE key = 'summary'").get();
  res.json({ types, stats: JSON.parse(stats.value), refreshedAt: stats.refreshed_at });
});

module.exports = appraiserRouter;

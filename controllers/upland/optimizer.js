const optimizerRouter = require("express").Router();
const { uplandUserFetch } = require("../../utils/uplandClient");
const { userExtractor } = require("../../middleware");
const User = require("../../models/user");
const { getCollections, getCities, getNeighborhoodsByCity } = require("../../utils/uplandCatalog");
const { optimize } = require("../../utils/collectionOptimizer");

const PAGE_SIZE = 100;
const MAX_PAGES = 50;

async function fetchAllUserProperties(token) {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await uplandUserFetch(`/user/assets/properties?currentPage=${page}&pageSize=${PAGE_SIZE}`, token);
    const rows = res?.results || [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE || (res.totalResults && all.length >= res.totalResults)) break;
  }
  return all;
}

const clamp = (n, lo, hi, fallback) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback);

// GET /api/upland/optimizer/collections?yieldRate=0.049&rewardMonths=0
// Plans which collections to complete with the logged-in user's own
// properties, read through their connected Upland account.
optimizerRouter.get("/collections", userExtractor, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user?.uplandAccessToken) return res.status(403).json({ error: "Upland account not connected" });

  const yieldRate = clamp(Number(req.query.yieldRate), 0.001, 1, 0.049);
  const rewardMonths = clamp(Number(req.query.rewardMonths), 0, 120, 0);

  let properties;
  try {
    properties = await fetchAllUserProperties(user.uplandAccessToken);
  } catch (err) {
    const expired = err.status === 401 || err.status === 403;
    return res.status(502).json({
      error: expired ? "Upland rejected the stored token; reconnect your Upland account" : `Upland API error: ${err.message}`,
    });
  }

  const [collections, cities] = await Promise.all([getCollections(), getCities()]);
  // Only collections in cities the user owns property in (plus cross-city ones) can matter.
  const myCities = [...new Set(properties.map(p => p.city?.id).filter(id => id != null))];
  const relevant = collections.filter(c => c.cityId == null || myCities.includes(c.cityId));
  const neighborhoodsByCity = await getNeighborhoodsByCity(myCities);
  // A city with no collections of its own isn't open to collections yet (Istanbul was the case
  // that showed it: Upland refused its properties). Recomputed from the live catalog each time.
  const citiesWithCollections = new Set(collections.map(c => c.cityId).filter(id => id != null));
  const closedCityIds = myCities.filter(id => !citiesWithCollections.has(id));

  res.json(optimize({ properties, collections: relevant, cities, neighborhoodsByCity, yieldRate, rewardMonths, closedCityIds }));
});

module.exports = optimizerRouter;

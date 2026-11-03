// Cached Developers API catalogs (collections, cities, neighborhoods). They
// change rarely, so one fetch serves many requests.
const { uplandFetch } = require("./uplandClient");

const TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map(); // key -> { value, expiresAt }

async function cached(key, load) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await load();
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

const getCollections = () => cached("collections", async () => (await uplandFetch("/collections")).results || []);

const getCities = () => cached("cities", async () => (await uplandFetch("/cities")).cities || []);

/** Neighborhood ids and names only; the API also sends large boundary polygons. */
const getNeighborhoods = cityId =>
  cached(`neighborhoods:${cityId}`, async () =>
    ((await uplandFetch(`/neighborhoods?cityId=${cityId}`)).results || []).map(n => ({ id: n.id, name: n.name })),
  );

async function getNeighborhoodsByCity(cityIds) {
  const map = new Map();
  for (const id of cityIds) map.set(id, await getNeighborhoods(id));
  return map;
}

module.exports = { getCollections, getCities, getNeighborhoods, getNeighborhoodsByCity };

// Property floors per city. Live asks come from the chain's listing book
// (table t2); which city a listing is in comes from the Developers API
// property catalog. Both go through the indexer's single throttled client.
const { parseAsset } = require("./decode");
const { nowIso, setCheckpoint, getCheckpoint } = require("./db");
const { pageTable } = require("./designs");

/** Replace listings_current with a fresh copy of the whole t2 table (~40 requests). */
async function snapshotListings({ db, client, log = () => {} }) {
  // Replaying deltas starts from when the read began, so changes made during
  // the ~8 minute read are applied afterwards rather than lost.
  const startedAt = nowIso();
  let pages = 0;
  const rows = await pageTable(client, { code: "playuplandme", scope: "playuplandme", table: "t2" }, {
    onPage: n => {
      if (++pages % 50 === 0) log(`listings: ${n} rows read so far (${client.requestCount} requests)`);
    },
  });
  const at = nowIso();
  const insert = db.prepare(`INSERT INTO listings_current (property_id, seller, price_upx, price_fiat, flags, snapshot_at)
    VALUES (?, ?, ?, ?, ?, ?)`);
  db.transaction(() => {
    db.prepare("DELETE FROM listings_current").run();
    for (const r of rows) {
      insert.run(String(r.a34), r.a35 ?? null, parseAsset(r.f4)?.amount ?? null, parseAsset(r.f3)?.amount ?? null,
        [r.f21, r.f22, r.f23].map(f => (f ? 1 : 0)).join(""), at);
    }
  })();
  enrichListings(db);
  setCheckpoint(db, "snapshot:listings", at);
  setCheckpoint(db, "listings:applied", startedAt);
  log(`listings: ${rows.length} live listings, ${client.requestCount} requests`);
  return rows.length;
}

/**
 * Bring listings_current forward with the t2 table changes the tail/backfill
 * stored since the last snapshot or apply: a written row is upserted, a
 * removed row deleted. Within a block, removals go first so a sale followed
 * by an instant relist ends up listed. Returns rows applied.
 */
function applyListingDeltas(db) {
  const since = getCheckpoint(db, "listings:applied");
  if (!since) return 0;
  const deltas = db.prepare(
    "SELECT ts, block_num, present, primary_key, data FROM raw_deltas WHERE feed = 't2' AND ts >= ? ORDER BY block_num, present",
  ).all(since);
  if (!deltas.length) return 0;
  // Each written row takes its city, address and mint from the catalog in the same statement.
  const upsert = db.prepare(`INSERT OR REPLACE INTO listings_current
      (property_id, seller, price_upx, price_fiat, flags, snapshot_at, address, city_id, city_name, neighborhood_name, mint_price)
    SELECT @id, @seller, @upx, @fiat, @flags, @at, p.address, p.city_id, p.city_name, p.neighborhood_name, p.mint_price
    FROM (SELECT 1) LEFT JOIN properties p ON p.id = @id`);
  const remove = db.prepare("DELETE FROM listings_current WHERE property_id = ?");
  db.transaction(() => {
    for (const d of deltas) {
      const r = JSON.parse(d.data);
      const id = String(r.a34 ?? d.primary_key);
      if (d.present) {
        upsert.run({ id, seller: r.a35 ?? null, upx: parseAsset(r.f4)?.amount ?? null, fiat: parseAsset(r.f3)?.amount ?? null,
          flags: [r.f21, r.f22, r.f23].map(f => (f ? 1 : 0)).join(""), at: d.ts });
      } else remove.run(id);
    }
  })();
  setCheckpoint(db, "listings:applied", deltas[deltas.length - 1].ts);
  return deltas.length;
}

/**
 * Page every property of the given cities from /v2/properties (500 per
 * request) into the properties table.
 */
async function syncProperties({ db, client, apiUrl, basicAuth, cityIds, log = () => {}, shouldStop = () => false }) {
  const headers = { Authorization: `Basic ${basicAuth}` };
  const cities = (await client.getJson(`${apiUrl}/cities`, headers)).cities || [];
  const wanted = cityIds?.length ? cities.filter(c => cityIds.includes(c.id)) : cities;
  const upsert = db.prepare(`INSERT OR REPLACE INTO properties
    (id, address, city_id, city_name, neighborhood_id, neighborhood_name, mint_price, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let total = 0;
  for (const city of wanted) {
    let token;
    let count = 0;
    do {
      if (shouldStop()) {
        log("properties: stopped; rerun to continue");
        return total;
      }
      const qs = new URLSearchParams({ cityId: city.id, pageSize: 500, ...(token ? { nextPageToken: token } : {}) });
      const page = await client.getJson(`${apiUrl}/v2/properties?${qs}`, headers);
      const at = nowIso();
      db.transaction(() => {
        for (const p of page.results || []) {
          upsert.run(String(p.id), p.address ?? null, p.city?.id ?? city.id, p.city?.name ?? city.name,
            p.neighborhood?.id ?? null, p.neighborhood?.name ?? null, p.mintPrice ?? null, p.status ?? null, at);
        }
      })();
      count += (page.results || []).length;
      token = page.nextPageToken || null;
    } while (token);
    total += count;
    enrichListings(db, city.id);
    setCheckpoint(db, `snapshot:properties:${city.id}`, nowIso());
    log(`properties: ${city.name} ${count} (${client.requestCount} requests so far)`);
  }
  return total;
}

/**
 * Look up, one by one, listed properties the city paging didn't return. Some
 * areas (e.g. Piedmont and West Berkeley, filed under Oakland) never come back
 * from /v2/properties?cityId= but do from /properties/{id}. Properties the API
 * can't place are remembered so they aren't asked about again.
 */
async function lookupUnmapped({ db, client, apiUrl, basicAuth, limit = Infinity, log = () => {}, shouldStop = () => false }) {
  const headers = { Authorization: `Basic ${basicAuth}` };
  const ids = db.prepare(`SELECT l.property_id AS id FROM listings_current l
    WHERE l.city_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM properties p WHERE p.id = l.property_id)
      AND NOT EXISTS (SELECT 1 FROM properties_missing m WHERE m.id = l.property_id)`).all().map(r => r.id);
  const todo = ids.slice(0, limit);
  log(`unmapped: ${ids.length} listed properties to look up${todo.length < ids.length ? `, doing ${todo.length}` : ""}`);
  const upsert = db.prepare(`INSERT OR REPLACE INTO properties
    (id, address, city_id, city_name, neighborhood_id, neighborhood_name, mint_price, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const missing = db.prepare("INSERT OR REPLACE INTO properties_missing (id, checked_at) VALUES (?, ?)");
  let found = 0;
  let unknown = 0;
  for (let i = 0; i < todo.length; i++) {
    if (shouldStop()) break;
    let p;
    try {
      p = await client.getJson(`${apiUrl}/properties/${todo[i]}`, headers);
    } catch (err) {
      if (err.status !== 404) throw err;
      p = null; // the API doesn't know this property: remember it, keep going
    }
    if (p?.city?.id != null) {
      upsert.run(String(todo[i]), p.address ?? null, p.city.id, p.city.name ?? null, p.neighborhood?.id ?? null,
        p.neighborhood?.name ?? null, p.mintPrice ?? null, p.status ?? null, nowIso());
      found++;
    } else {
      missing.run(String(todo[i]), nowIso());
      unknown++;
    }
    if ((i + 1) % 200 === 0 || i === todo.length - 1) {
      enrichListings(db);
      log(`unmapped: ${i + 1}/${todo.length} looked up (${found} placed, ${unknown} unknown to the API)`);
    }
  }
  return { found, unknown };
}

/**
 * Copy city, address and mint from the property catalog onto listings that
 * don't have them yet (optionally one city), so floor queries never join.
 */
function enrichListings(db, cityId = null) {
  return db.prepare(`
    UPDATE listings_current SET address = p.address, city_id = p.city_id, city_name = p.city_name,
      neighborhood_name = p.neighborhood_name, mint_price = p.mint_price
    FROM properties p
    WHERE p.id = listings_current.property_id AND listings_current.city_id IS NULL
      ${cityId == null ? "" : "AND p.city_id = ?"}`).run(...(cityId == null ? [] : [cityId])).changes;
}

/**
 * Floors for the chosen cities (all when empty), plus the cheapest listings
 * across them. Every figure is an index lookup on (city_id, price), so it
 * stays fast however big the listing book gets. Listings whose property isn't
 * in the catalog yet are counted as unmapped.
 */
function computeFloors(db, { cityIds = [], excludeIds = [], top = 25, robustRank = 3 } = {}) {
  // Only the picked cities; else everything but the excluded ones; else all of Upland.
  const inCities = cityIds.length ? `AND city_id IN (${cityIds.map(() => "?").join(",")})`
    : excludeIds.length ? `AND city_id IS NOT NULL AND city_id NOT IN (${excludeIds.map(() => "?").join(",")})`
    : "AND city_id IS NOT NULL";
  const cityArgs = cityIds.length ? cityIds : excludeIds;
  const counts = db.prepare(`SELECT city_id, city_name, SUM(price_upx > 0) AS upx, SUM(price_fiat > 0) AS usd
    FROM listings_current WHERE 1 = 1 ${inCities} GROUP BY city_id`).all(...cityArgs);
  const nth = db.prepare(`SELECT * FROM listings_current WHERE city_id = ? AND price_upx > 0
    ORDER BY price_upx, property_id LIMIT 1 OFFSET ?`);
  const lowestMarkup = db.prepare(`SELECT * FROM listings_current WHERE city_id = ? AND price_upx > 0 AND mint_price > 0
    ORDER BY price_upx / mint_price, property_id LIMIT 1`);
  const usdFloor = db.prepare(`SELECT * FROM listings_current WHERE city_id = ? AND price_fiat > 0
    ORDER BY price_fiat, property_id LIMIT 1`);

  const listing = r => r && {
    propertyId: r.property_id, address: r.address, city: r.city_name, neighborhood: r.neighborhood_name,
    mintPrice: r.mint_price, priceUpx: r.price_upx || null, priceUsd: r.price_fiat || null,
    markup: r.mint_price && r.price_upx ? Math.round((r.price_upx / r.mint_price) * 100) / 100 : null,
  };
  const cities = counts.map(c => {
    const n = c.upx || 0;
    const at = k => (k < n ? nth.get(c.city_id, k) : null);
    return {
      cityId: c.city_id,
      cityName: c.city_name,
      upxListings: n,
      usdListings: c.usd || 0,
      floor: listing(at(0)),
      robustFloor: at(robustRank - 1)?.price_upx ?? null,
      medianAsk: n ? (at(Math.floor((n - 1) / 2)).price_upx + at(Math.floor(n / 2)).price_upx) / 2 : null,
      lowestMarkup: listing(lowestMarkup.get(c.city_id)),
      usdFloor: listing(usdFloor.get(c.city_id)),
    };
  }).sort((a, b) => (a.floor?.priceUpx ?? Infinity) - (b.floor?.priceUpx ?? Infinity));

  const cheapest = db.prepare(`SELECT * FROM listings_current WHERE price_upx > 0 ${inCities}
    ORDER BY price_upx, property_id LIMIT ?`).all(...cityArgs, top).map(listing);
  const totals = db.prepare("SELECT COUNT(*) AS listings, SUM(city_id IS NULL) AS unmapped FROM listings_current").get();
  return {
    snapshotAt: getCheckpoint(db, "snapshot:listings"),
    changesAppliedTo: getCheckpoint(db, "listings:applied"),
    listings: totals.listings,
    unmappedListings: totals.unmapped || 0,
    cities,
    cheapest,
  };
}

module.exports = { snapshotListings, applyListingDeltas, syncProperties, lookupUnmapped, enrichListings, computeFloors };

// Which building stands on which property. Upland's own POST /buildings search
// is broken server-side (500 "ST_Intersects: Operation on mixed SRID
// geometries", even for its documented example, 2026-11-03), and property
// records don't mention buildings. The chain does: playuplandme table a21 has
// one row per placed structure NFT (f45 = the NFT id, a34 = the property id).
// Verified on 12 rows: all structure NFTs, each on its own property. A
// construction starts with a SPARKLT transfer memo "BUILD,<nft>,<property>,...".
const { nowIso, getCheckpoint, setCheckpoint } = require("./db");
const { pageTable } = require("./designs");

const row = r => ({ nft_id: Number(r.f45), property_id: String(r.a34), f54: r.f54 ?? null, f55: r.f55 ?? null });

// The chain's "display name" for a building design is mostly a description
// ("This model represents Glass Tower"), and the four original buildings are
// literally named "test". Turn them into names (checked against the 40 most
// built designs, 2026-11-03).
// The original Small Town House shares its name with a later design
// (smltwnhouse2, named "Small Town House" on-chain), so it says so.
const ORIGINALS = { smltownhouse: "Small Town House (original)", townhouse: "Town House", aptbuilding: "Apartment Building", ranchhouse: "Ranch House" };
const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);
const titleCase = s => s.split(" ").map((w, i) => (i > 0 && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
function buildingName(displayName, token) {
  if (ORIGINALS[token]) return ORIGINALS[token];
  let s = String(displayName || "").replace(/\s+/g, " ").trim();
  if (!s || /^test$/i.test(s)) return token;
  let m = /^(.+?)'s (.+?) is a winning entry from the (\d{4}) Master Builders Contest/i.exec(s);
  if (m) return `${m[2]} (by ${m[1]}, Master Builders ${m[3]})`;
  m = /^Master Builders (\d{4}) model winner - (.+)$/i.exec(s);
  if (m) return `${m[2]} (Master Builders ${m[1]})`;
  s = s
    .replace(/^This (?:model|structure) (?:is an NFT replica of|repe?res?e?n?ts)\s+/i, "")
    .replace(/^(?:a|an)\s+/i, "")
    .replace(/^limited time\s+/i, "")
    .replace(/\s+with fixed colors$/i, "")
    .replace(/\s+within the Upland Metaverse$/i, "")
    .replace(/\s+residential model$/i, "")
    .replace(/\s+and is part of .*$/i, "")
    .replace(/\.$/, "");
  return s ? titleCase(s) : token;
}

/** Replace property_buildings with a fresh copy of a21 (~650 requests). */
async function snapshotBuildings({ db, client, log = () => {} }) {
  // Changes made during the read are replayed from when it began.
  const startedAt = nowIso();
  let pages = 0;
  const rows = await pageTable(client, { code: "playuplandme", scope: "playuplandme", table: "a21" }, {
    onPage: n => {
      if (++pages % 100 === 0) log(`buildings: ${n} rows read so far (${client.requestCount} requests)`);
    },
  });
  const at = nowIso();
  const insert = db.prepare(`INSERT OR REPLACE INTO property_buildings (nft_id, property_id, f54, f55, updated_at)
    VALUES (@nft_id, @property_id, @f54, @f55, @at)`);
  db.transaction(() => {
    db.prepare("DELETE FROM property_buildings").run();
    for (const r of rows) insert.run({ ...row(r), at });
  })();
  enrichBuildings(db);
  setCheckpoint(db, "snapshot:buildings", at);
  setCheckpoint(db, "buildings:applied", startedAt);
  log(`buildings: ${rows.length} placed buildings, ${client.requestCount} requests`);
  return rows.length;
}

const timeOrNull = t => (t && !t.startsWith("1970") ? new Date(`${t}Z`).toISOString() : null);
const construction = (r, at) => ({
  nft_id: Number(r.f45), started_at: timeOrNull(r.f51), eta: timeOrNull(r.f52),
  progress: Number(r.f53) || 0, needed: Number(r.f123) || null, updated_at: at,
});

/** Replace constructions with a fresh copy of a23 (~50 requests). */
async function snapshotConstructions({ db, client, log = () => {} }) {
  const startedAt = nowIso();
  const rows = await pageTable(client, { code: "playuplandme", scope: "playuplandme", table: "a23" });
  const at = nowIso();
  const insert = db.prepare(`INSERT OR REPLACE INTO constructions (nft_id, started_at, eta, progress, needed, updated_at)
    VALUES (@nft_id, @started_at, @eta, @progress, @needed, @updated_at)`);
  db.transaction(() => {
    db.prepare("DELETE FROM constructions").run();
    for (const r of rows) insert.run(construction(r, at));
  })();
  setCheckpoint(db, "snapshot:constructions", at);
  setCheckpoint(db, "constructions:applied", startedAt);
  log(`constructions: ${rows.length} buildings under construction, ${client.requestCount} requests`);
  return rows.length;
}

/** Replay a23 changes: a construction written or updated, or removed when it's done. */
function applyConstructionDeltas(db) {
  const since = getCheckpoint(db, "constructions:applied");
  if (!since) return 0;
  const deltas = db.prepare(
    "SELECT ts, present, primary_key, data FROM raw_deltas WHERE feed = 'a23' AND ts >= ? ORDER BY block_num, present",
  ).all(since);
  if (!deltas.length) return 0;
  const upsert = db.prepare(`INSERT OR REPLACE INTO constructions (nft_id, started_at, eta, progress, needed, updated_at)
    VALUES (@nft_id, @started_at, @eta, @progress, @needed, @updated_at)`);
  const remove = db.prepare("DELETE FROM constructions WHERE nft_id = ?");
  db.transaction(() => {
    for (const d of deltas) {
      const r = JSON.parse(d.data);
      if (d.present) upsert.run(construction(r, d.ts));
      else remove.run(Number(r.f45 ?? d.primary_key));
    }
  })();
  setCheckpoint(db, "constructions:applied", deltas[deltas.length - 1].ts);
  return deltas.length;
}

/**
 * Bring property_buildings forward with the a21 changes stored since the last
 * snapshot or apply: written rows upserted, removed rows deleted, in block
 * order (removals first within a block). Returns rows applied.
 */
function applyBuildingDeltas(db) {
  const since = getCheckpoint(db, "buildings:applied");
  if (!since) return 0;
  const deltas = db.prepare(
    "SELECT ts, present, primary_key, data FROM raw_deltas WHERE feed = 'a21' AND ts >= ? ORDER BY block_num, present",
  ).all(since);
  if (!deltas.length) return 0;
  // Each written row takes its type and city in the same statement (when they're known yet).
  const upsert = db.prepare(`INSERT OR REPLACE INTO property_buildings (nft_id, property_id, f54, f55, updated_at, token_name, city_id)
    SELECT @nft_id, @property_id, @f54, @f55, @at,
      (SELECT token_name FROM nft_items WHERE id = @nft_id AND category = 'structure'),
      (SELECT city_id FROM properties WHERE id = @property_id)`);
  const remove = db.prepare("DELETE FROM property_buildings WHERE nft_id = ?");
  db.transaction(() => {
    for (const d of deltas) {
      const r = JSON.parse(d.data);
      if (d.present) upsert.run({ ...row(r), at: d.ts });
      else remove.run(Number(r.f45 ?? d.primary_key));
    }
  })();
  setCheckpoint(db, "buildings:applied", deltas[deltas.length - 1].ts);
  return deltas.length;
}

/**
 * Fill in each building's type (from nft_items) and city (from the property
 * catalog) where they're still missing: new buildings whose NFT or property
 * wasn't known yet when they were stored. Returns rows filled.
 */
function enrichBuildings(db) {
  const filled = db.prepare(`UPDATE property_buildings SET
      token_name = COALESCE(token_name, (SELECT token_name FROM nft_items i WHERE i.id = property_buildings.nft_id AND i.category = 'structure')),
      city_id = COALESCE(city_id, (SELECT city_id FROM properties p WHERE p.id = property_buildings.property_id))
    WHERE token_name IS NULL OR city_id IS NULL`).run().changes;
  // When it went up, from the BUILD payment that started it (none = before the stored history).
  db.prepare(`UPDATE property_buildings SET built_at = k.ts FROM building_builds k
    WHERE k.nft_id = property_buildings.nft_id AND property_buildings.built_at IS NULL`).run();
  // Still being built? (A building is placed when construction starts.)
  db.prepare(`UPDATE property_buildings SET under_construction = 1
    WHERE nft_id IN (SELECT nft_id FROM constructions) AND under_construction IS NOT 1`).run();
  db.prepare(`UPDATE property_buildings SET under_construction = 0
    WHERE under_construction IS NOT 0 AND nft_id NOT IN (SELECT nft_id FROM constructions)`).run();
  // Big parcels can hold many buildings (up to 157 on one, 2026-11-03), so each
  // row knows how many finished buildings share its property: a parcel's price
  // is no one building's price.
  db.prepare(`UPDATE property_buildings SET on_property = c.n
    FROM (SELECT property_id, SUM(under_construction = 0) AS n FROM property_buildings GROUP BY property_id) AS c
    WHERE c.property_id = property_buildings.property_id AND property_buildings.on_property IS NOT c.n`).run();
  return filled;
}

/**
 * Rebuild building_types, the Building Browser's dropdown: per city (0 = a
 * property not in the catalog) and building, how many stand there and on how
 * many properties, how many of those properties are for sale, and the cheapest
 * UPX ask among properties where it's the only building. One pass over
 * property_buildings, so the dropdown itself is a lookup.
 */
function refreshBuildingTypes(db) {
  const names = new Map(db.prepare(`SELECT d.token_name, n.display_name FROM designs d
    LEFT JOIN design_names n ON n.category_name_id = d.category_name_id WHERE d.category = 'structure'`).all()
    .map(r => [r.token_name, r.display_name]));
  enrichBuildings(db);
  const rows = db.prepare(`
    SELECT COALESCE(b.city_id, 0) AS city_id, b.token_name,
      SUM(b.under_construction = 0) AS buildings, SUM(b.under_construction = 1) AS under_construction,
      COUNT(DISTINCT CASE WHEN b.under_construction = 0 THEN b.property_id END) AS properties,
      COUNT(DISTINCT CASE WHEN b.under_construction = 0 AND l.property_id IS NOT NULL THEN b.property_id END) AS for_sale,
      MIN(CASE WHEN b.under_construction = 0 AND b.on_property = 1 THEN NULLIF(l.price_upx, 0) END) AS cheapest_upx
    FROM property_buildings b
    LEFT JOIN listings_current l ON l.property_id = b.property_id
    WHERE b.token_name IS NOT NULL
    GROUP BY 1, 2`).all();
  const unidentified = db.prepare("SELECT COUNT(*) AS n FROM property_buildings WHERE token_name IS NULL").get().n;
  const at = nowIso();
  const insert = db.prepare(`INSERT INTO building_types (city_id, token_name, name, buildings, under_construction, properties, for_sale, cheapest_upx, refreshed_at)
    VALUES (@city_id, @token_name, @name, @buildings, @under_construction, @properties, @for_sale, @cheapest_upx, @at)`);
  db.transaction(() => {
    db.prepare("DELETE FROM building_types").run();
    for (const r of rows) insert.run({ ...r, name: buildingName(names.get(r.token_name), r.token_name), at });
    setCheckpoint(db, "buildings:unidentified", String(unidentified));
    setCheckpoint(db, "buildings:refreshed", at);
  })();
  return rows.length;
}

module.exports = { snapshotBuildings, applyBuildingDeltas, snapshotConstructions, applyConstructionDeltas, enrichBuildings, refreshBuildingTypes, buildingName };

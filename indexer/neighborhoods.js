// Neighborhood boundaries, and which neighborhoods border each other, for the
// property appraiser's land comps. The Developers API's GET /neighborhoods?cityId=
// returns each neighborhood's boundary polygon (lon/lat), center and area
// (verified 2026-11-03: San Francisco's 116, ids and names matching the
// properties' neighborhood ids). Borders within 30 m of each other count as
// neighbors; for San Francisco that matched the real map (the Mission borders
// Bernal Heights, Noe Valley, Potrero Hill, SoMa, ...), and it lifted the share
// of SF properties with 15+ comparable sales from 39% to 87%.
const { nowIso, setCheckpoint } = require("./db");

const TOUCH_METRES = 30;
const METRES_PER_DEGREE = 111_320;

/** A polygon, multipolygon or bare ring as a list of rings of [lon, lat]. */
function ringsOf(boundaries) {
  if (!Array.isArray(boundaries) || !boundaries.length) return [];
  if (typeof boundaries[0][0] === "number") return [boundaries];
  if (typeof boundaries[0][0][0] === "number") return boundaries;
  return boundaries.flat(1);
}

// Flat metres around a latitude: plenty accurate across one city.
function projector(lat0) {
  const k = Math.cos((lat0 * Math.PI) / 180) * METRES_PER_DEGREE;
  return ([lon, lat]) => [lon * k, lat * METRES_PER_DEGREE];
}

function segmentDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function shape(n, project) {
  const rings = ringsOf(n.boundaries).map(r => r.map(project));
  const pts = rings.flat();
  const xs = pts.map(p => p[0]);
  const ys = pts.map(p => p[1]);
  return { id: n.id, rings, box: pts.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : null };
}

function touches(a, b, tol) {
  if (!a.box || !b.box) return false;
  if (a.box[0] > b.box[2] + tol || b.box[0] > a.box[2] + tol || a.box[1] > b.box[3] + tol || b.box[1] > a.box[3] + tol) return false;
  for (const [x, y] of [[a, b], [b, a]]) {
    for (const ring of x.rings) {
      for (const p of ring) {
        for (const other of y.rings) {
          for (let i = 1; i < other.length; i++) if (segmentDistance(p, other[i - 1], other[i]) <= tol) return true;
        }
      }
    }
  }
  return false;
}

/** Pairs [idA, idB] (idA < idB) of neighborhoods whose borders come within `tol` metres. */
function borderingPairs(neighborhoods, tol = TOUCH_METRES) {
  const withShape = neighborhoods.filter(n => ringsOf(n.boundaries).length);
  if (!withShape.length) return [];
  const lats = withShape.map(n => (Array.isArray(n.center) ? n.center[1] : ringsOf(n.boundaries)[0][0][1]));
  const project = projector(lats.reduce((s, v) => s + v, 0) / lats.length);
  const shapes = withShape.map(n => shape(n, project));
  const pairs = [];
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      if (touches(shapes[i], shapes[j], tol)) pairs.push([Math.min(shapes[i].id, shapes[j].id), Math.max(shapes[i].id, shapes[j].id)]);
    }
  }
  return pairs;
}

/**
 * Store every city's neighborhoods and which of them border each other (one
 * API call per city, plus /cities). Returns neighborhoods stored.
 */
async function syncNeighborhoods({ db, client, apiUrl, basicAuth, cityIds = [], log = () => {}, shouldStop = () => false }) {
  const headers = { Authorization: `Basic ${basicAuth}` };
  const cities = (await client.getJson(`${apiUrl}/cities`, headers)).cities || [];
  const wanted = cityIds.length ? cities.filter(c => cityIds.includes(c.id)) : cities;
  const upsert = db.prepare(`INSERT OR REPLACE INTO neighborhoods (id, city_id, name, area, center_lon, center_lat, boundaries, updated_at)
    VALUES (@id, @city_id, @name, @area, @center_lon, @center_lat, @boundaries, @updated_at)`);
  const pair = db.prepare("INSERT OR IGNORE INTO neighborhood_adjacency (a, b) VALUES (?, ?)");
  let total = 0;
  for (const city of wanted) {
    if (shouldStop()) {
      log("neighborhoods: stopped; rerun to finish");
      break;
    }
    const list = (await client.getJson(`${apiUrl}/neighborhoods?cityId=${city.id}`, headers)).results || [];
    const pairs = borderingPairs(list);
    const at = nowIso();
    db.transaction(() => {
      const ids = list.map(n => n.id);
      if (ids.length) {
        const marks = ids.map(() => "?").join(", ");
        db.prepare(`DELETE FROM neighborhood_adjacency WHERE a IN (${marks}) OR b IN (${marks})`).run(...ids, ...ids);
      }
      for (const n of list) {
        upsert.run({
          id: n.id,
          city_id: n.cityId ?? city.id,
          name: n.name ?? null,
          area: n.area ?? null,
          center_lon: Array.isArray(n.center) ? n.center[0] : null,
          center_lat: Array.isArray(n.center) ? n.center[1] : null,
          boundaries: JSON.stringify(n.boundaries ?? null),
          updated_at: at,
        });
      }
      for (const [a, b] of pairs) {
        pair.run(a, b);
        pair.run(b, a);
      }
    })();
    total += list.length;
    log(`neighborhoods: ${city.name} ${list.length}, ${pairs.length} bordering pairs (${client.requestCount} requests so far)`);
  }
  setCheckpoint(db, "neighborhoods:refreshed", nowIso());
  return total;
}

module.exports = { ringsOf, borderingPairs, syncNeighborhoods, TOUCH_METRES };

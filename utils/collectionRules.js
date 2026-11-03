// Upland collections come from the Developers API (GET /collections) with their
// requirement as an English sentence ("Own 3 properties on Park Ave. in
// Manhattan"). This turns each sentence into a rule we can test a property
// against. Anything we can't read confidently is marked unsupported rather
// than guessed: a wrong match would mean a wrong recommendation.

const WORDS = {
  AVENUE: "AVE", STREET: "ST", BOULEVARD: "BLVD", DRIVE: "DR", ROAD: "RD", PLACE: "PL",
  LANE: "LN", COURT: "CT", TERRACE: "TER", PARKWAY: "PKWY", HIGHWAY: "HWY", EXPRESSWAY: "EXPY",
  SQUARE: "SQ", CIRCLE: "CIR", TRAIL: "TRL", CRESCENT: "CRES", ALLEY: "ALY", PLAZA: "PLZ",
  WEST: "W", EAST: "E", NORTH: "N", SOUTH: "S", SAINT: "ST", MOUNT: "MT",
};

/** Upper case, no punctuation, single spaces. */
const norm = s =>
  (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[.,'’]/g, "").replace(/\s+/g, " ").trim();

/** "West 8th Avenue" and "W 8TH AVE" both become "W 8TH AVE". */
const normStreet = s => norm(s).split(" ").map(w => WORDS[w] || w).join(" ");

/**
 * The street part of a property address. Handles "1467 28TH AVE",
 * "RUA MARTINS LAGE, 88B" and "12-14 MAIN ST": number-like tokens are dropped
 * and, with a comma, the first segment that has a real word wins.
 */
// Words that mean "street" on their own. When one is all that's left after
// dropping numbers, the number is the street's name: in Turkish addresses
// "63/4 SOKAK 4" is house 4 on 63/4 Sokak, a different street from "61 SOKAK".
const BARE_STREET_WORDS = new Set(["SOKAK", "SOKAGI", "SK", "CADDE", "CADDESI", "CD", "BULVAR", "BULVARI", "STREET", "ST", "AVENUE", "AVE", "ROAD", "RD"]);

function streetOf(address) {
  const isNumberish = t => /^\d+[A-Z]?$|^\d+-\d+[A-Z]?$|^\d+\/\d+[A-Z]?$/.test(t);
  const segments = norm(address.replace(/,/g, " , ")).split(" , ").map(s => s.trim());
  for (const seg of segments) {
    const tokens = seg.split(" ").filter(Boolean);
    const words = tokens.filter(t => !isNumberish(t));
    if (!words.length) continue;
    if (words.length === 1 && BARE_STREET_WORDS.has(words[0])) {
      const at = tokens.indexOf(words[0]);
      return normStreet(tokens.slice(0, at + 1).join(" ")); // keep the number that names the street
    }
    return normStreet(words.join(" "));
  }
  return "";
}

const CITY_ALIASES = { SF: "SAN FRANCISCO", NYC: "MANHATTAN", LA: "LOS ANGELES", KC: "KANSAS CITY", "WASHINGTON DC": "WASHINGTON" };

/** Neighborhood comparison ignores spaces and hyphens: "Haight-Ashbury" = "HAIGHT ASHBURY", "Sea Cliff" = "SEACLIFF". */
const placeKey = s => norm(s).replace(/[-\s]/g, "");

// "in the Wisconsin Ave NW" / "in the Rue de la Republique" name a street, not an area.
const STREET_HINT = /(^| )(AVE|ST|BLVD|DR|RD|PL|LN|CT|WAY|PKWY|HWY|RUE|AV|AVENIDA|RUA)( |$)/;

// Regions for the "Nomad" collections. Upland doesn't publish these lists, so
// they are our reading of the collection names (INFERRED) and every result
// that uses one says so. Confirmed by Upland accepting them in Fyscher's own
// collections (2026-11-02): Central = Nashville, Detroit; East = Washington,
// Brooklyn, Queens; West = Los Angeles, South Lake Tahoe. Las Vegas (NV) and
// Park City (UT) sit west of the central states and aren't coastal, so they
// count toward no regional Nomad, and Turkey isn't European Nomad (Fyscher's calls).
const REGIONS = {
  "SOUTH AMERICAN": c => ["BR", "AR", "CO", "CL", "PE", "UY"].includes(c.countryName),
  EUROPEAN: c => ["UK", "FR", "PT", "IT", "DE", "SP", "NL"].includes(c.countryName), // not TR (Fyscher, 2026-11-02)
  "EAST COAST": c => c.countryName === "US" && ["NY", "NJ", "FL", "MD", "D.C."].includes(c.stateName),
  "WEST COAST": c => c.countryName === "US" && ["CA", "WA", "OR"].includes(c.stateName),
  CENTRAL: c => c.countryName === "US" && ["IL", "MO", "TX", "OH", "MI", "LA", "TN", "NE"].includes(c.stateName),
};

const COUNT = "(?:any )?(\\d+|an?)";
const PROPS = "propert(?:y|ies)";

/**
 * Parse one Developers API collection into a rule.
 * ctx: { citiesById: Map<id, city>, neighborhoodsByCity: Map<cityId, [{id, name}]> }
 */
function parseCollection(col, ctx) {
  const base = { collectionId: col.id, name: col.name, amount: col.amount, boost: col.yieldBoost,
    reward: col.oneTimeReward, rarity: col.rarityLevel, cityId: col.cityId, requirements: col.requirements };
  const text = (col.requirements || "").trim().replace(/\s+/g, " ").replace(/\.$/, "");
  const lower = text.toLowerCase();
  const city = col.cityId != null ? ctx.citiesById.get(col.cityId) : null;
  const unsupported = reason => ({ ...base, type: "unsupported", reason });

  if (/curated|designed by|historic/.test(lower)) return unsupported("curated list of specific properties");

  let m;
  if (col.cityId == null) {
    if (new RegExp(`^own ${COUNT} ${PROPS} in upland$`, "i").test(text)) return { ...base, type: "any" };
    if (/in the same city$/i.test(text)) return { ...base, type: "sameCity" };
    if (/on the same street$/i.test(text)) return { ...base, type: "sameStreet" };
    if (/different countries$/i.test(text)) return { ...base, type: "distinct", by: "country", region: null };
    if ((m = /in \d+ different (.+?) cities(?: in .+)?$/i.exec(text)) ||
        (m = /in \d+ different cities (?:on|in) the (.+?) cities?$/i.exec(text))) {
      const key = Object.keys(REGIONS).find(k => norm(m[1]).replace(/ CITIES$/, "").includes(k));
      return key ? { ...base, type: "distinct", by: "city", region: key, inferred: true }
        : unsupported(`unknown region "${m[1]}"`);
    }
    if (/in \d+ different cities$/i.test(text)) return { ...base, type: "distinct", by: "city", region: null };
    return unsupported("cross-city rule we can't read");
  }
  if (!city) return unsupported(`unknown city id ${col.cityId}`);

  // Only "properties" count; "Own 2 Distilleries" names a curated building type.
  if (!new RegExp(`^own ${COUNT} ${PROPS} (on|in) `, "i").test(text)) return unsupported("not a plain property rule");

  const cityNames = new Set([norm(city.name), ...Object.entries(CITY_ALIASES).filter(([, v]) => v === norm(city.name)).map(([k]) => k)]);
  const stripCity = s => {
    const parts = s.split(/ in /i);
    return parts.length > 1 && cityNames.has(norm(parts[parts.length - 1])) ? parts.slice(0, -1).join(" in ") : s;
  };

  if ((m = new RegExp(`^own ${COUNT} ${PROPS} on (?:the )?(.+)$`, "i").exec(text))) {
    return { ...base, type: "street", street: normStreet(stripCity(m[2])) };
  }
  if ((m = new RegExp(`^own ${COUNT} ${PROPS} in (?:the )?(.+)$`, "i").exec(text))) {
    let place = stripCity(m[2]).replace(/ neighborhood$/i, "");
    if (cityNames.has(norm(place))) return { ...base, type: "city" };
    // "Downtown Bakersfield" in Bakersfield is the Downtown neighborhood.
    const cityWord = norm(city.name);
    if (norm(place).endsWith(` ${cityWord}`)) place = place.slice(0, place.length - city.name.length).trim();
    const hoods = ctx.neighborhoodsByCity.get(col.cityId) || [];
    const want = placeKey(place);
    const trimmed = want.replace(/(DISTRICT|AREA)$/, "");
    const hood = hoods.find(h => placeKey(h.name) === want) ||
      hoods.find(h => placeKey(h.name) === trimmed) ||
      hoods.find(h => placeKey(h.name).replace(/(DISTRICT|AREA)$/, "") === want);
    if (hood) return { ...base, type: "neighborhood", neighborhoodId: hood.id, neighborhood: norm(hood.name) };
    if (STREET_HINT.test(normStreet(place))) return { ...base, type: "street", street: normStreet(place), inferred: true };
    return unsupported(`no neighborhood called "${place}" in ${city.name}`);
  }
  return unsupported("unrecognized wording");
}

/** Can this property count toward a single-variant rule? (sameCity/sameStreet/distinct are grouped by the optimizer.) */
function eligible(rule, prop) {
  switch (rule.type) {
    case "any": return true;
    case "city": return prop.cityId === rule.cityId;
    case "street": return prop.cityId === rule.cityId && prop.street === rule.street;
    case "neighborhood": return prop.cityId === rule.cityId && prop.neighborhoodId === rule.neighborhoodId;
    default: return false;
  }
}

module.exports = { norm, normStreet, streetOf, parseCollection, eligible, REGIONS };

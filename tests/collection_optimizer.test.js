const { test, describe, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const supertest = require("supertest");

// node --test runs files in parallel processes; give this file its own users
// database so it can't race tests/users_api.test.js over the same file.
process.env.DB_PATH = path.join(os.tmpdir(), `kfm-optimizer-test-${process.pid}.db`);

const { streetOf, parseCollection } = require("../utils/collectionRules");
const { optimize, search, evaluate } = require("../utils/collectionOptimizer");

// A slice of the real catalogs (Developers API, 2026-10-30), wording kept verbatim.
const cities = [
  { id: 1, name: "San Francisco", stateName: "CA", countryName: "US" },
  { id: 3, name: "Manhattan", stateName: "NY", countryName: "US" },
  { id: 4, name: "Queens", stateName: "NY", countryName: "US" },
  { id: 12, name: "Santa Clara", stateName: "CA", countryName: "US" },
  { id: 14, name: "Kansas City", stateName: "MO", countryName: "US" },
  { id: 92, name: "Saint Denis", stateName: "FR", countryName: "FR" },
];
const neighborhoodsByCity = new Map([
  [1, [{ id: 10, name: "HAIGHT ASHBURY" }, { id: 11, name: "OUTER SUNSET" }, { id: 12, name: "INNER SUNSET" }, { id: 13, name: "SEACLIFF" }]],
  [12, [{ id: 943, name: "SOUTHWEST" }]],
]);
const col = (id, name, cityId, amount, yieldBoost, requirements, oneTimeReward = 0) =>
  ({ id, name, cityId, amount, yieldBoost, requirements, oneTimeReward, rarityLevel: 2 });
const collections = [
  col(35, "Park Ave", 3, 3, 2.22, "Own 3 properties on Park Ave. in Manhattan", 9900),
  col(155, "Southwest", 12, 3, 1.85, "Own 3 Properties in Southwest in Santa Clara", 11000),
  col(21, "City Pro", null, 5, 1.4, "Own 5 properties in the same city", 1200),
  col(7, "Newbie", null, 1, 1.1, "Own any 1 property in Upland", 800),
  col(1, "King of the Street", null, 3, 1.3, "Own 3 properties on the same street"),
  col(1621, "World Traveler", null, 5, 1.3, "Own a Property in 5 Different Cities"),
  col(19, "Haight-Ashbury", 1, 4, 1.6, "Own 4 properties in the Haight-Ashbury neighborhood in San Francisco"),
  col(5, "Sea Cliff", 1, 3, 2.3, "Own 3 properties in the Sea Cliff neighborhood in SF"),
  col(17, "Sunset", 1, 3, 1.5, "Own 3 properties in the Sunset Neighborhood in San Francisco"),
  col(181, "Distilleries", 14, 2, 2.78, "Own 2 Distilleries in Kansas City"),
  col(511, "Washington", 1, 3, 1.2, "Own 3 properties in San Francisco"),
];
const ctx = { citiesById: new Map(cities.map(c => [c.id, c])), neighborhoodsByCity };
const rule = id => parseCollection(collections.find(c => c.id === id), ctx);

describe("nomad regions", () => {
  const { REGIONS } = require("../utils/collectionRules");
  test("Central stops at the central states; Las Vegas and Park City fit no regional Nomad", () => {
    const city = (stateName, countryName = "US") => ({ stateName, countryName });
    assert.ok(REGIONS.CENTRAL(city("TN")) && REGIONS.CENTRAL(city("MI")) && REGIONS.CENTRAL(city("NE")));
    for (const st of ["NV", "UT"]) {
      assert.ok(!REGIONS.CENTRAL(city(st)), `${st} is not Central`);
      assert.ok(!REGIONS["WEST COAST"](city(st)), `${st} is not West Coast`);
    }
    assert.ok(REGIONS["WEST COAST"](city("CA")) && REGIONS["EAST COAST"](city("D.C.")));
    assert.ok(!REGIONS.EUROPEAN(city(null, "TR")), "Turkey is not European Nomad");
    assert.ok(REGIONS.EUROPEAN(city(null, "PT")) && REGIONS.EUROPEAN(city(null, "UK")));
  });
});

describe("collection rules", () => {
  test("street addresses reduce to a comparable street", () => {
    assert.deepStrictEqual(
      ["1467 28TH AVE", "RUA MARTINS LAGE, 88B", "12-14 West 8th Avenue", "100 Park Ave.", "63/4 SOKAK 4", "61 SOKAK 15"].map(streetOf),
      ["28TH AVE", "RUA MARTINS LAGE", "W 8TH AVE", "PARK AVE", "63/4 SOKAK", "61 SOKAK"],
    );
  });

  test("requirement sentences become rules", () => {
    assert.deepStrictEqual([rule(35).type, rule(35).street], ["street", "PARK AVE"]);
    assert.deepStrictEqual([rule(155).type, rule(155).neighborhoodId], ["neighborhood", 943]);
    assert.strictEqual(rule(21).type, "sameCity");
    assert.strictEqual(rule(7).type, "any");
    assert.strictEqual(rule(1).type, "sameStreet");
    assert.deepStrictEqual([rule(1621).type, rule(1621).by], ["distinct", "city"]);
    assert.strictEqual(rule(19).neighborhoodId, 10, "hyphen vs space");
    assert.strictEqual(rule(5).neighborhoodId, 13, "Sea Cliff vs SEACLIFF, and SF as the city");
    assert.strictEqual(rule(511).type, "city");
  });

  test("anything ambiguous or curated is flagged, never guessed", () => {
    assert.strictEqual(rule(17).type, "unsupported", "Sunset could be Inner or Outer");
    assert.strictEqual(rule(181).type, "unsupported", "Distilleries are a curated list");
  });
});

let nextId = 1;
const prop = (cityId, address, neighborhood, mintPrice) => ({
  id: nextId++,
  address,
  city: { id: cityId, name: cities.find(c => c.id === cityId).name },
  neighborhood,
  mintPrice,
  status: "Owned",
});
const SW = { id: 943, name: "SOUTHWEST" };

describe("collection optimizer", () => {
  test("puts the best properties in the strongest collections and skips a weaker conflicting one", () => {
    const properties = [
      prop(3, "100 PARK AVE", null, 90000), prop(3, "200 PARK AVE", null, 85000), prop(3, "300 PARK AVE", null, 80000),
      prop(12, "1 A ST", SW, 60000), prop(12, "2 B ST", SW, 55000), prop(12, "3 C ST", SW, 50000),
      prop(12, "1 EL CAMINO REAL", null, 40000), prop(12, "3 EL CAMINO REAL", null, 30000),
    ];
    const r = optimize({ properties, collections, cities, neighborhoodsByCity });
    assert.strictEqual(r.method, "optimal");
    assert.deepStrictEqual(r.plan.map(c => c.name), ["Park Ave", "Southwest", "Newbie"]);
    // City Pro would need all five Santa Clara properties and break Southwest (1.85 > 1.4).
    assert.ok(!r.plan.some(c => c.name === "City Pro"));
    assert.strictEqual(r.plan[2].properties[0].address, "1 EL CAMINO REAL", "Newbie takes the best leftover");
    const gain = r.plan.reduce((s, c) => s + c.monthlyGain, 0);
    assert.ok(Math.abs(gain - r.totals.monthlyGain) < 0.05);
    assert.ok(Math.abs(r.totals.monthlyBase - (490000 * 0.049) / 12) < 0.05);
  });

  test("World Traveler uses one property per city", () => {
    const properties = [1, 3, 4, 12, 92].map((c, i) => prop(c, `${i} MAIN ST`, null, 50000));
    properties.push(prop(1, "9 MAIN ST", null, 49000));
    const r = optimize({ properties, collections, cities, neighborhoodsByCity });
    const wt = r.plan.find(c => c.name === "World Traveler");
    assert.ok(wt, "World Traveler is chosen");
    assert.strictEqual(new Set(wt.properties.map(p => p.city)).size, 5);
  });

  test("current yield only counts collections that are still complete", () => {
    const tagged = (p, id) => ({ ...p, collection: { id, name: "x" } });
    const properties = [
      tagged(prop(3, "100 PARK AVE", null, 90000), 35), tagged(prop(3, "200 PARK AVE", null, 90000), 35), tagged(prop(3, "300 PARK AVE", null, 90000), 35),
      tagged(prop(12, "1 A ST", SW, 60000), 155), tagged(prop(12, "2 B ST", SW, 60000), 155), // Southwest needs 3: inactive
    ];
    const r = optimize({ properties, collections, cities, neighborhoodsByCity });
    const base = (390000 * 0.049) / 12;
    const parkGain = (270000 * 0.049 / 12) * (2.22 - 1);
    assert.ok(Math.abs(r.totals.monthlyCurrent - (base + parkGain)) < 0.05, "Southwest's boost is not counted");
    assert.deepStrictEqual(r.inactiveCurrent.map(c => [c.name, c.have, c.need]), [["Southwest", 2, 1]]);
  });

  test("cities not open to collections are left out of every collection", () => {
    const properties = [1, 3, 4, 12, 92].map((c, i) => prop(c, `${i} MAIN ST`, null, 50000));
    const r = optimize({ properties, collections, cities, neighborhoodsByCity, closedCityIds: [92] });
    assert.ok(!r.plan.some(c => c.properties.some(p => p.city === "Saint Denis")));
    assert.ok(!r.plan.some(c => c.name === "World Traveler"), "only 4 open cities left");
    assert.deepStrictEqual(r.notOpenForCollections, [{ city: "Saint Denis", properties: 1 }]);
    assert.ok(Math.abs(r.totals.monthlyBase - (250000 * 0.049) / 12) < 0.05, "still counted at base yield");
  });

  test("separates collections already set up from ones that need edits", () => {
    const tagged = (p, id) => ({ ...p, collection: { id, name: "x" } });
    const properties = [
      tagged(prop(3, "100 PARK AVE", null, 90000), 35), tagged(prop(3, "200 PARK AVE", null, 85000), 35), tagged(prop(3, "300 PARK AVE", null, 80000), 35),
      // Southwest is tagged with a weak member; the plan should swap it for the better one.
      tagged(prop(12, "1 A ST", SW, 60000), 155), tagged(prop(12, "2 B ST", SW, 55000), 155), tagged(prop(12, "9 Z ST", SW, 1000), 155),
      prop(12, "3 C ST", SW, 50000),
      tagged(prop(12, "1 EL CAMINO REAL", null, 40000), 21), // an active City Pro that the plan won't keep...
    ];
    const r = optimize({ properties, collections, cities, neighborhoodsByCity });
    const park = r.plan.find(c => c.name === "Park Ave");
    assert.deepStrictEqual([park.status, park.add.length, park.remove.length], ["keep", 0, 0]);
    const sw = r.plan.find(c => c.name === "Southwest");
    assert.strictEqual(sw.status, "change");
    assert.deepStrictEqual(sw.add.map(p => p.address), ["3 C ST"]);
    assert.deepStrictEqual(sw.remove.map(p => p.address), ["9 Z ST"]);
    assert.deepStrictEqual(r.dropped, [], "...but it's incomplete (1 of 5), so there's nothing active to undo");
  });

  test("never swaps properties between collections when the swap earns nothing", () => {
    // Four identical Queens properties on one street: King of the Street (x1.3) takes three,
    // World Traveler (x1.3) one. Any split pays the same, so the plan must keep the in-game one.
    const kots = collections.find(c => c.id === 1);
    const wt = collections.find(c => c.id === 1621);
    for (let inWt = 0; inWt < 4; inWt++) {
      const queens = [0, 1, 2, 3].map(k => ({ ...prop(4, `${k + 1} MAIN ST`, null, 30000), collection: { id: k === inWt ? 1621 : 1 } }));
      const others = [1, 3, 12, 92].map(cid => ({ ...prop(cid, `${cid} ELSEWHERE RD`, null, 20000), collection: { id: 1621 } }));
      const r = optimize({ properties: [...queens, ...others], collections: [kots, wt], cities, neighborhoodsByCity });
      assert.deepStrictEqual(r.plan.map(c => c.status), ["keep", "keep"], `World Traveler holds ${inWt + 1} MAIN ST`);
    }
  });

  test("reports collections one or two properties short", () => {
    const properties = [prop(3, "100 PARK AVE", null, 90000), prop(3, "200 PARK AVE", null, 85000)];
    const r = optimize({ properties, collections, cities, neighborhoodsByCity });
    const miss = r.nearMisses.find(n => n.name === "Park Ave");
    assert.deepStrictEqual([miss.have, miss.need], [2, 1]);
  });

  test("matches brute force on random portfolios", () => {
    let seed = 11;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const brute = (cands, rpm) => {
      let best = 0;
      for (let mask = 1; mask < 1 << cands.length; mask++) {
        const set = cands.filter((_, i) => mask & (1 << i));
        if (set.some((a, i) => set.some((b, j) => j > i && a.rule.collectionId === b.rule.collectionId))) continue;
        const r = evaluate(set, rpm);
        if (r && r.value > best) best = r.value;
      }
      return best;
    };
    for (let t = 0; t < 60; t++) {
      const props = Array.from({ length: 6 + Math.floor(rnd() * 7) }, (_, i) => ({ id: `p${i}`, monthly: 10 + rnd() * 200, cityId: Math.floor(rnd() * 4) }));
      const cands = [];
      for (let k = 0; k < 4 + Math.floor(rnd() * 4); k++) {
        const amount = 1 + Math.floor(rnd() * 3);
        const boost = 1 + rnd() * 1.5;
        for (let vi = 0; vi < (rnd() < 0.25 ? 2 : 1); vi++) {
          const v = { rule: { collectionId: k, amount, boost, reward: Math.floor(rnd() * 3000) }, members: props.filter(() => rnd() < 0.5),
            label: null, groupKey: rnd() < 0.2 ? p => p.cityId : null };
          if ((v.groupKey ? new Set(v.members.map(v.groupKey)).size : v.members.length) >= amount) cands.push(v);
        }
      }
      const withRewards = t % 2 === 1;
      const rpm = withRewards ? v => v.rule.reward / 12 : () => 0;
      const got = search(cands, rpm);
      assert.strictEqual(got.method, "optimal");
      // Rewards are split per slot in whole hundredths of a UPX, so allow that rounding.
      assert.ok(Math.abs(brute(cands, rpm) - got.value) <= (withRewards ? 0.05 * cands.length : 1e-6), `case ${t}`);
    }
  });
});

describe("GET /api/upland/optimizer/collections", () => {
  const app = require("../app");
  const User = require("../models/user");
  const api = supertest(app);
  const realFetch = global.fetch;
  after(() => {
    global.fetch = realFetch;
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(process.env.DB_PATH + suffix, { force: true });
  });

  const login = async username => {
    await User.deleteMany();
    await api.post("/api/users").send({ username, name: username, password: "testpass1" }).expect(201);
    const res = await api.post("/api/login").send({ username, password: "testpass1" }).expect(200);
    return res.body.token;
  };

  test("asks for an Upland connection first", async () => {
    const token = await login("optimizeruser");
    const res = await api.get("/api/upland/optimizer/collections").set("Authorization", `Bearer ${token}`).expect(403);
    assert.match(res.body.error, /not connected/);
  });

  test("plans from the user's own properties", async () => {
    const token = await login("optimizeruser2");
    const user = await User.findOne({ username: "optimizeruser2" });
    await User.update(user.id, { uplandAccessToken: "fake-upland-token" });

    const owned = [
      prop(3, "100 PARK AVE", null, 90000), prop(3, "200 PARK AVE", null, 85000), prop(3, "300 PARK AVE", null, 80000),
    ];
    const json = body => ({ ok: true, status: 200, json: async () => body });
    global.fetch = async url => {
      if (url.includes("/user/assets/properties")) return json({ currentPage: 1, pageSize: 100, totalResults: owned.length, results: owned });
      if (url.includes("/collections")) return json({ results: collections });
      if (url.includes("/cities")) return json({ cities });
      if (url.includes("/neighborhoods")) return json({ results: [] });
      throw new Error(`unexpected fetch ${url}`);
    };

    const res = await api.get("/api/upland/optimizer/collections?yieldRate=0.049").set("Authorization", `Bearer ${token}`).expect(200);
    assert.strictEqual(res.body.plan[0].name, "Park Ave");
    assert.strictEqual(res.body.totals.properties, 3);
  });
});

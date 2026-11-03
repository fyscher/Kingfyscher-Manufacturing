// Collection optimizer: given a player's properties and Upland's collection
// rules, choose which collections to complete and which properties to put in
// each so the extra monthly yield is as large as possible.
//
// Model (sources in the vault's "Upland Third-Party Tools" note):
// - Base yield is mint price x yieldRate per year (4.9% unless the player's
//   season rate differs); a collection multiplies its members' yield by its
//   yieldBoost.
// - A collection boosts exactly `amount` properties, and a property sits in one
//   collection at a time (ASSUMED: standard understanding, not stated by Upland).
// - Each collection is completed at most once.
//
// The search is branch and bound over a min-cost-flow relaxation, so a
// finished run is provably optimal under the model above.

const { streetOf, parseCollection, eligible, REGIONS } = require("./collectionRules");
const { createGraph, minCostFlow } = require("./minCostFlow");


function prepareProperties(rawProps, citiesById, yieldRate) {
  return rawProps.map(p => {
    const city = citiesById.get(p.city?.id) || {};
    const mintPrice = Number(p.mintPrice) || 0;
    return {
      id: String(p.id),
      address: p.address || "",
      street: streetOf(p.address || ""),
      cityId: p.city?.id ?? null,
      cityName: p.city?.name ?? city.name ?? null,
      countryName: city.countryName ?? null,
      stateName: city.stateName ?? null,
      neighborhoodId: p.neighborhood?.id ?? null,
      neighborhoodName: p.neighborhood?.name ?? null,
      mintPrice,
      monthly: (mintPrice * yieldRate) / 12,
      currentCollectionId: p.collection?.id ?? null,
    };
  });
}

const groupBy = (items, keyOf) => {
  const groups = new Map();
  for (const it of items) {
    const k = keyOf(it);
    if (k == null || k === "") continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  return groups;
};

/** Turn rules into concrete options ("variants") the player could actually fill. */
function buildVariants(rules, props) {
  const variants = [];
  const add = (rule, members, label, groupKey = null) => {
    const groups = groupKey ? new Set(members.map(groupKey).filter(k => k != null)).size : members.length;
    if (groups >= rule.amount) variants.push({ rule, members, label, groupKey });
  };
  for (const rule of rules) {
    switch (rule.type) {
      case "any":
      case "city":
      case "street":
      case "neighborhood":
        add(rule, props.filter(p => eligible(rule, p)), null);
        break;
      case "sameCity":
        for (const [, members] of groupBy(props, p => p.cityId)) add(rule, members, members[0].cityName);
        break;
      case "sameStreet":
        for (const [, members] of groupBy(props, p => (p.street ? `${p.cityId}|${p.street}` : null))) {
          add(rule, members, `${members[0].street}, ${members[0].cityName}`);
        }
        break;
      case "distinct": {
        const inRegion = rule.region
          ? props.filter(p => REGIONS[rule.region]({ countryName: p.countryName, stateName: p.stateName }))
          : props;
        add(rule, inRegion, rule.region, rule.by === "country" ? p => p.countryName : p => p.cityId);
        break;
      }
      default:
        break;
    }
  }
  return variants;
}

const weight = (p, v) => Math.round(p.monthly * (v.rule.boost - 1) * 100); // centi-UPX/month

/** Best this option could do on its own: its top members (one per group where required). */
function standalone(v) {
  let pool = v.members;
  if (v.groupKey) {
    const best = new Map();
    for (const p of v.members) {
      const k = v.groupKey(p);
      if (k != null && (!best.has(k) || best.get(k).monthly < p.monthly)) best.set(k, p);
    }
    pool = [...best.values()];
  }
  const top = [...pool].sort((a, b) => b.monthly - a.monthly).slice(0, v.rule.amount);
  return top.length < v.rule.amount ? 0 : top.reduce((s, p) => s + weight(p, v), 0) / 100;
}

/** Boost earned by a fill, in centi-UPX/month. */
const fillWeight = (set, assigned) => assigned.reduce((s, ms, i) => s + ms.reduce((t, p) => t + weight(p, set[i]), 0), 0);

/**
 * Exact best assignment for a fixed set of options, by min-cost flow.
 * Returns null when the set can't be filled without sharing properties.
 * `prefer(p, v)` (0 or 1) breaks ties between equally good fills: values are
 * scaled past the most it could add up to, so it never costs any yield.
 */
function evaluate(set, rewardPerMonth, { prefer } = {}) {
  const slots = set.reduce((s, v) => s + v.rule.amount, 0);
  const scale = prefer ? slots + 1 : 1;
  // An option never needs more of its top candidates than all the slots in play
  // (but a tie-break may want an equal one further down, so keep them all then).
  const trimmed = set.map(v => ({ v, members: prefer ? v.members : [...v.members].sort((a, b) => b.monthly - a.monthly).slice(0, v.groupKey ? undefined : slots) }));
  const propNode = new Map();
  let next = 2 + set.length;
  const groupNodes = [];
  for (const { v, members } of trimmed) {
    for (const p of members) if (!propNode.has(p.id)) propNode.set(p.id, next++);
    if (v.groupKey) {
      const keys = new Map();
      for (const p of members) {
        const k = v.groupKey(p);
        if (k != null && !keys.has(k)) keys.set(k, next++);
      }
      groupNodes.push(keys);
    } else groupNodes.push(null);
  }
  const g = createGraph(next);
  const S = 0;
  const T = 1;
  const memberEdges = [];
  trimmed.forEach(({ v, members }, i) => {
    const vNode = 2 + i;
    g.addEdge(S, vNode, v.rule.amount, 0);
    for (const p of members) {
      const from = v.groupKey ? groupNodes[i].get(v.groupKey(p)) : vNode;
      if (from == null) continue;
      memberEdges.push({ i, p, edge: g.addEdge(from, propNode.get(p.id), 1, -(weight(p, v) * scale + (prefer ? prefer(p, v) : 0))) });
    }
    if (v.groupKey) for (const node of groupNodes[i].values()) g.addEdge(vNode, node, 1, 0);
  });
  for (const node of propNode.values()) g.addEdge(node, T, 1, 0);

  const { flow } = minCostFlow(g, S, T, slots);
  if (flow < slots) return null;
  const assigned = set.map(() => []);
  for (const { i, p, edge } of memberEdges) if (g.edges[edge].flow > 0) assigned[i].push(p);
  const rewards = set.reduce((s, v) => s + rewardPerMonth(v), 0);
  return { value: fillWeight(set, assigned) / 100 + rewards, assigned };
}

const BIG = 1e9; // per-slot bonus that makes forced collections fill first (centi-UPX)

/**
 * Relaxation for branch and bound: collections may be partly filled, and the
 * variants of one collection may share its slots. Every real plan is feasible
 * here, so the value is an upper bound. `forced` collections must fill one
 * chosen variant completely; `excluded` ones are out.
 */
function relax(candidates, byCollection, rewardPerMonth, { forced, excluded }) {
  const nodeOf = new Map();
  let next = 2;
  const node = key => {
    if (!nodeOf.has(key)) nodeOf.set(key, next++);
    return nodeOf.get(key);
  };
  const plan = [];
  for (const [cid, idxs] of byCollection) {
    if (excluded.has(cid)) continue;
    const allowed = forced.has(cid) ? [forced.get(cid)] : idxs;
    plan.push({ cid, allowed, amount: candidates[idxs[0]].rule.amount, isForced: forced.has(cid) });
  }
  // Build nodes first so the graph can be sized.
  for (const c of plan) {
    node(`c${c.cid}`);
    for (const i of c.allowed) {
      const v = candidates[i];
      node(`v${i}`);
      for (const p of v.members) {
        node(`p${p.id}`);
        if (v.groupKey) node(`g${i}:${v.groupKey(p)}`);
      }
    }
  }
  const g = createGraph(next);
  const S = 0;
  const T = 1;
  const colEdge = new Map();
  const varEdge = new Map();
  const memberEdges = [];
  let forcedSlots = 0;
  for (const c of plan) {
    if (c.isForced) forcedSlots += c.amount;
    colEdge.set(c.cid, g.addEdge(S, nodeOf.get(`c${c.cid}`), c.amount, c.isForced ? -BIG : 0));
    for (const i of c.allowed) {
      const v = candidates[i];
      const perSlot = -Math.round((rewardPerMonth(v) * 100) / v.rule.amount);
      const vNode = nodeOf.get(`v${i}`);
      varEdge.set(i, g.addEdge(nodeOf.get(`c${c.cid}`), vNode, v.rule.amount, perSlot));
      const seenGroups = new Set();
      for (const p of v.members) {
        let from = vNode;
        if (v.groupKey) {
          const gk = `g${i}:${v.groupKey(p)}`;
          if (!seenGroups.has(gk)) {
            seenGroups.add(gk);
            g.addEdge(vNode, nodeOf.get(gk), 1, 0);
          }
          from = nodeOf.get(gk);
        }
        memberEdges.push({ i, p, edge: g.addEdge(from, nodeOf.get(`p${p.id}`), 1, -weight(p, v)) });
      }
    }
  }
  for (const [key, n] of nodeOf) if (key.startsWith("p")) g.addEdge(n, T, 1, 0);

  const { cost } = minCostFlow(g, S, T, Infinity, { onlyProfitable: true });
  const flowOf = id => g.edges[id].flow;
  for (const c of plan) if (c.isForced && flowOf(colEdge.get(c.cid)) < c.amount) return null;

  const value = (-cost - BIG * forcedSlots) / 100;
  const fractional = [];
  const chosen = [];
  for (const c of plan) {
    const f = flowOf(colEdge.get(c.cid));
    if (f === 0) continue;
    const used = c.allowed.filter(i => flowOf(varEdge.get(i)) > 0);
    if (f === c.amount && used.length === 1) chosen.push(used[0]);
    // Branch on every allowed variant, least-used first, so the most-used is explored first.
    else fractional.push({ cid: c.cid, variants: [...c.allowed].sort((a, b) => flowOf(varEdge.get(a)) - flowOf(varEdge.get(b))), weight: f / c.amount });
  }
  fractional.sort((a, b) => b.weight - a.weight);
  const assigned = new Map(chosen.map(i => [i, []]));
  for (const { i, p, edge } of memberEdges) if (assigned.has(i) && g.edges[edge].flow > 0) assigned.get(i).push(p);
  return { value, fractional, chosen, assigned };
}

/**
 * Branch and bound over which collections to complete. Each node solves the
 * relaxation; a node whose collections all come out full-or-empty is a real
 * plan and, being optimal for its relaxation, needs no further branching.
 */
function search(candidates, rewardPerMonth, { nodeLimit = 20000 } = {}) {
  const byCollection = new Map();
  candidates.forEach((v, i) => {
    const cid = v.rule.collectionId;
    if (!byCollection.has(cid)) byCollection.set(cid, []);
    byCollection.get(cid).push(i);
  });
  let best = { value: 0, set: [], assigned: [] };
  let nodes = 0;
  let complete = true;
  const stack = [{ forced: new Map(), excluded: new Set() }];
  while (stack.length) {
    if (++nodes > nodeLimit) {
      complete = false;
      break;
    }
    const state = stack.pop();
    const r = relax(candidates, byCollection, rewardPerMonth, state);
    if (!r || r.value <= best.value + 1e-9) continue;
    if (r.fractional.length === 0) {
      best = { value: r.value, set: r.chosen.map(i => candidates[i]), assigned: r.chosen.map(i => r.assigned.get(i)) };
      continue;
    }
    const f = r.fractional[0];
    // Depth first: forcing the most-used variant is explored first, excluding last.
    stack.push({ forced: state.forced, excluded: new Set([...state.excluded, f.cid]) });
    for (const i of f.variants) stack.push({ forced: new Map([...state.forced, [f.cid, i]]), excluded: state.excluded });
  }
  return { ...best, method: complete ? "optimal" : "best found (search limit hit)", nodes };
}

/**
 * properties: Developers API /user/assets/properties rows.
 * collections, cities, neighborhoodsByCity: Developers API catalogs.
 */
function optimize({ properties, collections, cities, neighborhoodsByCity, yieldRate = 0.049, rewardMonths = 0, closedCityIds = [] }) {
  const citiesById = new Map(cities.map(c => [c.id, c]));
  const props = prepareProperties(properties, citiesById, yieldRate);
  // Cities not yet open to collections (e.g. Istanbul, 2026-11-02): their
  // properties still earn base yield but can't go into any collection.
  const closed = new Set(closedCityIds);
  const usable = props.filter(p => !closed.has(p.cityId));
  const rules = collections.map(c => parseCollection(c, { citiesById, neighborhoodsByCity }));
  const rewardPerMonth = v => (rewardMonths > 0 ? (v.rule.reward || 0) / rewardMonths : 0);

  const candidates = buildVariants(rules, usable)
    .map(v => ({ ...v, solo: standalone(v) + rewardPerMonth(v) }))
    .filter(v => v.solo > 0)
    .sort((a, b) => b.solo - a.solo);
  const best = search(candidates, rewardPerMonth);
  // Equally good fills are common (two x1.3 collections that both take a Miami
  // property). Settle ties toward how things are tagged in-game now, so the plan
  // never asks for a swap that earns nothing.
  if (best.set.length && props.some(p => p.currentCollectionId != null)) {
    const settled = evaluate(best.set, rewardPerMonth, { prefer: (p, v) => (p.currentCollectionId === v.rule.collectionId ? 1 : 0) });
    if (settled && fillWeight(best.set, settled.assigned) >= fillWeight(best.set, best.assigned)) best.assigned = settled.assigned;
  }

  const plan = best.set
    .map((v, i) => {
      const members = best.assigned[i];
      const base = members.reduce((s, p) => s + p.monthly, 0);
      return {
        collectionId: v.rule.collectionId,
        name: v.rule.name,
        variant: v.label,
        type: v.rule.type,
        inferred: Boolean(v.rule.inferred),
        rarity: v.rule.rarity,
        boost: v.rule.boost,
        reward: v.rule.reward,
        requirements: v.rule.requirements,
        monthlyBase: round(base),
        monthlyBoosted: round(base * v.rule.boost),
        monthlyGain: round(base * (v.rule.boost - 1)),
        properties: members.map(p => ({ id: p.id, address: p.address, city: p.cityName, mintPrice: p.mintPrice, monthly: round(p.monthly) })),
      };
    })
    .sort((a, b) => b.monthlyGain - a.monthlyGain);

  const baseMonthly = props.reduce((s, p) => s + p.monthly, 0);
  const planGain = plan.reduce((s, c) => s + c.monthlyGain, 0);
  // A collection only pays its boost while complete. Properties can stay tagged
  // to a collection after a member is sold; those count at base yield.
  const colById = new Map(collections.map(c => [c.id, c]));
  const currentKnown = props.some(p => p.currentCollectionId != null);
  const taggedCount = new Map();
  for (const p of props) if (p.currentCollectionId != null) taggedCount.set(p.currentCollectionId, (taggedCount.get(p.currentCollectionId) || 0) + 1);
  const activeNow = id => colById.has(id) && taggedCount.get(id) >= colById.get(id).amount;
  const currentMonthly = props.reduce((s, p) => s + p.monthly * (activeNow(p.currentCollectionId) ? colById.get(p.currentCollectionId).yieldBoost : 1), 0);
  // Compare the plan with how properties are tagged in-game right now: a
  // collection whose members already match needs no edits; the rest say exactly
  // which addresses to add and which to take out.
  const taggedTo = new Map();
  for (const p of props) {
    if (p.currentCollectionId == null) continue;
    if (!taggedTo.has(p.currentCollectionId)) taggedTo.set(p.currentCollectionId, []);
    taggedTo.get(p.currentCollectionId).push(p);
  }
  const brief = p => ({ id: p.id, address: p.address, city: p.cityName ?? p.city });
  for (const c of plan) {
    const now = taggedTo.get(c.collectionId) || [];
    const planIds = new Set(c.properties.map(p => p.id));
    const nowIds = new Set(now.map(p => p.id));
    c.add = c.properties.filter(p => !nowIds.has(p.id)).map(brief);
    c.remove = now.filter(p => !planIds.has(p.id)).map(brief);
    c.status = !now.length ? "new" : c.add.length || c.remove.length ? "change" : "keep";
  }
  const planned = new Set(plan.map(c => c.collectionId));
  const dropped = [...taggedTo.entries()]
    .filter(([id]) => !planned.has(id) && activeNow(id))
    .map(([id, ps]) => ({ collectionId: id, name: colById.get(id).name, boost: colById.get(id).yieldBoost, remove: ps.map(brief) }));

  const inactiveCurrent = [...taggedCount.entries()]
    .filter(([id]) => colById.has(id) && !activeNow(id))
    .map(([id, have]) => ({ collectionId: id, name: colById.get(id).name, boost: colById.get(id).yieldBoost, have, need: colById.get(id).amount - have }))
    .sort((a, b) => b.boost - a.boost);

  const nearMisses = rules
    .filter(r => ["city", "street", "neighborhood"].includes(r.type))
    .map(r => ({ r, have: usable.filter(p => eligible(r, p)).length }))
    .filter(({ r, have }) => have > 0 && have < r.amount && r.amount - have <= 2)
    .map(({ r, have }) => ({ collectionId: r.collectionId, name: r.name, boost: r.boost, reward: r.reward, requirements: r.requirements, have, need: r.amount - have }))
    .sort((a, b) => b.boost - a.boost);

  const myCities = new Set(props.map(p => p.cityId));
  const unsupported = rules
    .filter(r => r.type === "unsupported" && (r.cityId == null || myCities.has(r.cityId)))
    .map(r => ({ collectionId: r.collectionId, name: r.name, boost: r.boost, requirements: r.requirements, reason: r.reason }));

  return {
    settings: { yieldRate, rewardMonths },
    method: best.method,
    candidates: candidates.length,
    totals: {
      properties: props.length,
      monthlyBase: round(baseMonthly),
      monthlyWithPlan: round(baseMonthly + planGain),
      monthlyGain: round(planGain),
      monthlyCurrent: currentKnown ? round(currentMonthly) : null,
      gainVsCurrent: currentKnown ? round(baseMonthly + planGain - currentMonthly) : null,
      rewardsInPlan: plan.reduce((s, c) => s + (c.reward || 0), 0),
    },
    plan,
    dropped,
    inactiveCurrent,
    notOpenForCollections: [...groupBy(props.filter(p => closed.has(p.cityId)), p => p.cityName)].map(([city, ps]) => ({ city, properties: ps.length })),
    nearMisses,
    unsupported,
    coverage: { collections: rules.length, readable: rules.filter(r => r.type !== "unsupported").length },
    assumptions: [
      `Base yield ${(yieldRate * 100).toFixed(2)}% of mint price per year.`,
      "A property counts toward one collection at a time, and each collection is completed once.",
      "Nomad regions are our reading of the collection names.",
      rewardMonths > 0 ? `One-time rewards spread over ${rewardMonths} months.` : "One-time rewards are listed but not optimized for.",
    ],
  };
}

const round = n => Math.round(n * 100) / 100;

module.exports = { optimize, prepareProperties, buildVariants, evaluate, search, standalone };

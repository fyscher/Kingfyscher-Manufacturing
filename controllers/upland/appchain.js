const appchainRouter = require("express").Router();
const {
  getActions,
  getPropertyPurchases,
  parsePurchaseAction,
} = require("../../utils/appchainClient");
const { uplandFetch } = require("../../utils/uplandClient");

appchainRouter.get("/purchases", async (req, res) => {
  const { limit = 20, before, after, sort = "desc" } = req.query;

  const result = await getPropertyPurchases({
    limit: Math.min(Number(limit), 100),
    sort,
    before,
    after,
  });

  const purchases = result.actions.map(parsePurchaseAction);

  res.json({
    total: result.total?.value,
    purchases,
  });
});

appchainRouter.get("/purchases/property/:propertyId", async (req, res) => {
  const targetId = req.params.propertyId;
  const { limit = 50 } = req.query;
  const maxPages = 10;
  const pageSize = 100;
  const matches = [];
  let before;

  for (let page = 0; page < maxPages && matches.length < Number(limit); page++) {
    const result = await getPropertyPurchases({
      limit: pageSize,
      sort: "desc",
      before,
    });

    const actions = result.actions || [];
    if (actions.length === 0) break;

    for (const action of actions) {
      const data = action.act?.data || {};
      if (String(data.a45) === String(targetId)) {
        matches.push(parsePurchaseAction(action));
      }
    }

    before = actions[actions.length - 1]?.["@timestamp"];
  }

  let property = null;
  try {
    property = await uplandFetch(`/properties/${targetId}`);
  } catch {
    // property details unavailable
  }

  res.json({
    property,
    purchases: matches.slice(0, Number(limit)),
  });
});

appchainRouter.get("/actions", async (req, res) => {
  const { filter, account, limit = 20, sort = "desc", before, after } =
    req.query;

  const result = await getActions({
    filter,
    account,
    limit: Math.min(Number(limit), 100),
    sort,
    before,
    after,
  });

  res.json({
    total: result.total?.value,
    actions: result.actions,
  });
});

// GET /api/upland/appchain/nft-activity?category=&limit=50
// Returns recent NFT mints, transfers, and burns from the uplandnftact contract.
// category filters to a specific NFT type: outdoordecor, structornmt, structure, seeds, uppie
appchainRouter.get("/nft-activity", async (req, res) => {
  const { category, limit = 50 } = req.query;
  const n = Math.min(Number(limit), 200);

  const [issueRes, transferRes, burnRes] = await Promise.all([
    getActions({ filter: "uplandnftact:issue",       limit: n, sort: "desc" }),
    getActions({ filter: "uplandnftact:transfernft", limit: n, sort: "desc" }),
    getActions({ filter: "uplandnftact:burnnft",     limit: n, sort: "desc" }),
  ]);

  const parseNftName = (memo) => {
    const m = (memo || "").match(/NFT "([^"]+)"/);
    return m ? m[1] : null;
  };

  const mints = (issueRes.actions || [])
    .filter(a => !category || a.act?.data?.category === category)
    .map(a => {
      const d = a.act?.data || {};
      return {
        type:      "mint",
        timestamp: a["@timestamp"] || a.timestamp,
        nftId:     d.dgood_ids?.[0] ?? null,
        to:        d.to,
        category:  d.category,
        tokenName: d.token_name,
        nftName:   parseNftName(d.memo),
        ipfs:      (d.memo || "").match(/ipfs\/([A-Za-z0-9]+)/)?.[1] ?? null,
      };
    });

  const transfers = (transferRes.actions || [])
    .map(a => {
      const d = a.act?.data || {};
      const name = parseNftName(d.memo);
      return {
        type:      "transfer",
        timestamp: a["@timestamp"] || a.timestamp,
        nftId:     d.dgood_ids?.[0] ?? null,
        from:      d.from,
        to:        d.to,
        nftName:   name,
      };
    });

  const burns = (burnRes.actions || [])
    .map(a => {
      const d = a.act?.data || {};
      return {
        type:      "burn",
        timestamp: a["@timestamp"] || a.timestamp,
        nftId:     d.dgood_ids?.[0] ?? null,
        owner:     d.owner,
      };
    });

  const all = [...mints, ...transfers, ...burns]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, n);

  res.json({ count: all.length, events: all });
});

// GET /api/upland/appchain/structure-placements?limit=50
// Returns recent a32 (place structure) and a25 (remove structure) actions.
// a32: a54=EOS account, p115=array of NFT dGood IDs placed
// a25: a51=EOS account, p55=array of property IDs structures were removed from
appchainRouter.get("/structure-placements", async (req, res) => {
  const { limit = 50 } = req.query;
  const n = Math.min(Number(limit), 200);

  const [placeRes, removeRes] = await Promise.all([
    getActions({ filter: "playuplandme:a32", limit: n, sort: "desc" }),
    getActions({ filter: "playuplandme:a25", limit: n, sort: "desc" }),
  ]);

  const placements = (placeRes.actions || []).map(a => {
    const d = a.act?.data || {};
    return {
      type:      "place",
      timestamp: a["@timestamp"] || a.timestamp,
      eosAccount: d.a54,
      nftIds:    d.p115 || [],
    };
  });

  const removals = (removeRes.actions || []).map(a => {
    const d = a.act?.data || {};
    return {
      type:        "remove",
      timestamp:   a["@timestamp"] || a.timestamp,
      eosAccount:  d.a51,
      propertyIds: (d.p55 || []).map(String),
    };
  });

  const all = [...placements, ...removals]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, n);

  res.json({ count: all.length, events: all });
});

// GET /api/upland/appchain/spark-staking?limit=50
// Returns recent n211 SPARKLT staking state updates.
// p234 = property IDs, p235 = staking entries (ttt5: {f155=structureNFT, f154=SPARKLTamount})
appchainRouter.get("/spark-staking", async (req, res) => {
  const { limit = 50 } = req.query;
  const n = Math.min(Number(limit), 200);

  const result = await getActions({ filter: "playuplandme:n211", limit: n, sort: "desc" });

  const events = (result.actions || []).map(a => {
    const d = a.act?.data || {};
    const propertyIds = (d.p234 || []).map(String);

    // p235 is a mixed array: ttt5 = structure staking entry, uint8 = separator
    const stakingEntries = (d.p235 || [])
      .filter(e => Array.isArray(e) && e[0] === "ttt5" && e[1])
      .map(e => ({
        structureNftId: String(e[1].f155 || ""),
        sparklt:        parseFloat((e[1].f154 || "0 SPARKLT").split(" ")[0]) || 0,
      }));

    return {
      timestamp:    a["@timestamp"] || a.timestamp,
      propertyIds,
      stakingEntries,
      totalSparklt: stakingEntries.reduce((s, e) => s + e.sparklt, 0),
    };
  });

  res.json({ count: events.length, events });
});

// GET /api/upland/appchain/marketplace?limit=50
// Returns recent NFT marketplace activity: completed sales (n111) and new listings (n12).
// n111: p1=seller, p2=buyer, p45=sale price, p133/p134=fees
// n12:  p23=seller, p15=NFT ID, p21=price (variant: uint64 or asset string)
appchainRouter.get("/marketplace", async (req, res) => {
  const { limit = 50 } = req.query;
  const n = Math.min(Number(limit), 200);

  const [salesRes, listingsRes] = await Promise.all([
    getActions({ filter: "playuplandme:n111", limit: n, sort: "desc" }),
    getActions({ filter: "playuplandme:n12",  limit: n, sort: "desc" }),
  ]);

  const parseAsset = (val) => {
    if (!val) return null;
    if (typeof val === "string") return parseFloat(val.split(" ")[0]) || null;
    if (typeof val === "number") return val;
    return null;
  };

  const sales = (salesRes.actions || []).map(a => {
    const d = a.act?.data || {};
    return {
      type:      "sale",
      timestamp: a["@timestamp"] || a.timestamp,
      seller:    d.p1,
      buyer:     d.p2,
      priceUpx:  parseAsset(d.p45),
      fee1Upx:   parseAsset(d.p133),
      fee2Upx:   parseAsset(d.p134),
    };
  });

  const listings = (listingsRes.actions || []).map(a => {
    const d = a.act?.data || {};
    // p21 is a variant: ["uint64", value] or ["asset", "1234.00 UPX"]
    let priceUpx = null;
    if (Array.isArray(d.p21)) {
      priceUpx = parseAsset(d.p21[1]);
    } else {
      priceUpx = parseAsset(d.p21);
    }
    return {
      type:      "listing",
      timestamp: a["@timestamp"] || a.timestamp,
      seller:    d.p23,
      nftId:     String(d.p15 || ""),
      priceUpx,
    };
  });

  const all = [...sales, ...listings]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, n);

  res.json({ count: all.length, events: all });
});

// GET /api/upland/appchain/tournaments?limit=20
// Returns recent tournament schedules (n154) and score recordings (n155).
// n154: p221=tournament ID, p222=start, p223=end
// n155: p221=tournament ID, p224=array of {f34: EOS account, f152: score}
appchainRouter.get("/tournaments", async (req, res) => {
  const { limit = 20 } = req.query;
  const n = Math.min(Number(limit), 100);

  const [schedRes, scoreRes] = await Promise.all([
    getActions({ filter: "playuplandme:n154", limit: n, sort: "desc" }),
    getActions({ filter: "playuplandme:n155", limit: n, sort: "desc" }),
  ]);

  const schedules = (schedRes.actions || []).map(a => {
    const d = a.act?.data || {};
    return {
      type:         "schedule",
      timestamp:    a["@timestamp"] || a.timestamp,
      tournamentId: d.p221,
      startTime:    d.p222,
      endTime:      d.p223,
    };
  });

  const scores = (scoreRes.actions || []).map(a => {
    const d = a.act?.data || {};
    return {
      type:         "scores",
      timestamp:    a["@timestamp"] || a.timestamp,
      tournamentId: d.p221 ?? null,
      participants: (d.p224 || []).map(e => ({
        eosAccount: e.f34,
        score:      e.f152,
      })),
    };
  });

  // Merge schedules and scores by tournament ID
  const tourneyMap = {};
  for (const s of schedules) {
    tourneyMap[s.tournamentId] = { ...s, scores: null };
  }
  for (const s of scores) {
    if (s.tournamentId != null && tourneyMap[s.tournamentId]) {
      tourneyMap[s.tournamentId].scores = s.participants;
    }
  }

  const tournaments = Object.values(tourneyMap).sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );

  res.json({
    count:      tournaments.length,
    tournaments,
    rawScores:  scores.filter(s => !tourneyMap[s.tournamentId]),
  });
});

module.exports = appchainRouter;

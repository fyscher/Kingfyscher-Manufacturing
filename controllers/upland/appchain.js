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

module.exports = appchainRouter;

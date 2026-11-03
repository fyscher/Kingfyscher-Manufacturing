const userRouter = require("express").Router();
const { uplandUserFetch } = require("../../utils/uplandClient");
const { userExtractor } = require("../../middleware");
const User = require("../../models/user");

const requireUplandToken = async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.uplandAccessToken) {
    return res.status(403).json({ error: "Upland account not connected" });
  }
  req.uplandToken = user.uplandAccessToken;
  next();
};

userRouter.get(
  "/profile",
  userExtractor,
  requireUplandToken,
  async (req, res) => {
    const result = await uplandUserFetch("/user/profile", req.uplandToken);
    res.json(result);
  },
);

// GET /api/upland/user/assets/nfts?currentPage=1&pageSize=50&categories=outdoordecor,structornmt&textSearch=
// One page at a time: asking Upland for every NFT at once ran ~125 s and timed out.
userRouter.get(
  "/assets/nfts",
  userExtractor,
  requireUplandToken,
  async (req, res) => {
    const params = new URLSearchParams({
      currentPage: String(Math.max(Number.parseInt(req.query.currentPage, 10) || 1, 1)),
      pageSize: String(Math.min(Math.max(Number.parseInt(req.query.pageSize, 10) || 50, 10), 100)),
    });
    // Upland wants categories array-encoded (categories[]=...); a plain value gets a 400.
    for (const c of String(req.query.categories || "").split(",").filter(Boolean)) params.append("categories[]", c);
    if (req.query.textSearch) params.set("textSearch", String(req.query.textSearch));
    try {
      res.json(await uplandUserFetch(`/user/assets/nfts?${params}`, req.uplandToken));
    } catch (err) {
      res.status(502).json({ error: `Upland API error: ${err.status ?? err.message}` });
    }
  },
);

userRouter.get(
  "/balances",
  userExtractor,
  requireUplandToken,
  async (req, res) => {
    const result = await uplandUserFetch("/user/balances", req.uplandToken);
    res.json(result);
  },
);

userRouter.get(
  "/assets/properties",
  userExtractor,
  requireUplandToken,
  async (req, res) => {
    const result = await uplandUserFetch(
      "/user/assets/properties",
      req.uplandToken,
    );
    res.json(result);
  },
);

module.exports = userRouter;

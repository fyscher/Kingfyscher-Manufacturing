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

userRouter.get(
  "/assets/nfts",
  userExtractor,
  requireUplandToken,
  async (req, res) => {
    const result = await uplandUserFetch("/user/assets/nfts", req.uplandToken);
    res.json(result);
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

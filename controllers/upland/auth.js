const authRouter = require("express").Router();
const { uplandFetch } = require("../../utils/uplandClient");
const { userExtractor } = require("../../middleware");
const User = require("../../models/user");

authRouter.post("/init", userExtractor, async (req, res) => {
  const result = await uplandFetch("/auth/otp/init", { method: "POST" });

  await User.update(req.user.id, { uplandConnectionCode: result.code });

  res.json(result);
});

authRouter.post("/webhooks", async (req, res) => {
  const { type } = req.body;

  switch (type) {
    case "AuthenticationSuccess": {
      const { code, userId, accessToken } = req.body;
      const user = await User.findOne({ uplandConnectionCode: code });
      if (user) {
        await User.update(user.id, {
          uplandUserId: userId,
          uplandAccessToken: accessToken,
          uplandConnectedAt: new Date(),
          uplandConnectionCode: null,
        });
      }
      break;
    }
    case "AuthenticationFailure": {
      const { code } = req.body;
      const user = await User.findOne({ uplandConnectionCode: code });
      if (user) {
        await User.update(user.id, { uplandConnectionCode: null });
      }
      break;
    }
    case "UserDisconnectedApplication": {
      const { userId } = req.body;
      const user = await User.findOne({ uplandUserId: userId });
      if (user) {
        await User.update(user.id, {
          uplandUserId: null,
          uplandAccessToken: null,
          uplandConnectedAt: null,
        });
      }
      break;
    }
  }

  res.status(200).end();
});

module.exports = authRouter;

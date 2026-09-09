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
  // Upland's actual webhook payload nests everything but `type` under
  // `data` — e.g. { type: "AuthenticationSuccess", data: { code, userId,
  // accessToken } }. This was previously destructured straight off the
  // top-level body, so code/userId/accessToken were always undefined and
  // every webhook silently no-opped. Confirmed against Upland's own docs
  // and against real webhook traffic (fly logs) 2026-09-09.
  const { type, data = {} } = req.body;
  const { userId } = data;
  console.log(`Upland webhook received: type=${type}${userId ? ` userId=${userId}` : ""}`);

  switch (type) {
    case "AuthenticationSuccess": {
      const { code, accessToken } = data;
      const user = await User.findOne({ uplandConnectionCode: code });
      if (user) {
        await User.update(user.id, {
          uplandUserId: userId,
          uplandAccessToken: accessToken,
          uplandConnectedAt: new Date().toISOString(),
          uplandConnectionCode: null,
        });
        console.log(`Upland account linked for user ${user.username}`);
      } else {
        console.log("AuthenticationSuccess webhook: no user found with a matching pending connection code (already cleared, or code mismatch)");
      }
      break;
    }
    case "AuthenticationFailure": {
      // Deliberately leave uplandConnectionCode in place — Upland's OTP entry
      // allows retry, and a mistyped-then-corrected attempt should still be
      // able to match against the same pending code (see 2026-09-09 bug: a
      // failure here was wiping the code before a same-session retry's real
      // AuthenticationSuccess webhook arrived, silently losing the link).
      console.log("AuthenticationFailure webhook received, leaving pending connection code intact for retry");
      break;
    }
    case "UserDisconnectedApplication": {
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

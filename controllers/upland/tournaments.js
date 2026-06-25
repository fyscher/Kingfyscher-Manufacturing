const tournamentRouter = require("express").Router();
const { uplandFetch, uplandUserFetch } = require("../../utils/uplandClient");
const { userExtractor } = require("../../middleware");
const User = require("../../models/user");

tournamentRouter.post("/settings", async (req, res) => {
  const result = await uplandFetch("/rumble-tournament-settings", {
    method: "POST",
    body: JSON.stringify(req.body),
  });
  res.json(result);
});

tournamentRouter.post("/", async (req, res) => {
  const result = await uplandFetch("/rumble-tournaments", {
    method: "POST",
    body: JSON.stringify(req.body),
  });
  res.json(result);
});

tournamentRouter.post("/:id/join", userExtractor, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.uplandAccessToken) {
    return res.status(403).json({ error: "Upland account not connected" });
  }
  const result = await uplandUserFetch(
    `/rumble-tournaments/${req.params.id}/join`,
    user.uplandAccessToken,
    { method: "POST", body: JSON.stringify(req.body) },
  );
  res.json(result);
});

tournamentRouter.patch("/:id/close-registration", async (req, res) => {
  const result = await uplandFetch(
    `/rumble-tournaments/${req.params.id}/close-registration`,
    { method: "PATCH" },
  );
  res.json(result);
});

tournamentRouter.patch("/:id/start", async (req, res) => {
  const result = await uplandFetch(
    `/rumble-tournaments/${req.params.id}/start`,
    { method: "PATCH" },
  );
  res.json(result);
});

tournamentRouter.post("/:id/scores", async (req, res) => {
  const result = await uplandFetch(
    `/rumble-tournaments/${req.params.id}/scores`,
    { method: "POST", body: JSON.stringify(req.body) },
  );
  res.json(result);
});

tournamentRouter.post("/:id/resolve", async (req, res) => {
  const result = await uplandFetch(
    `/rumble-tournaments/${req.params.id}/resolve`,
    { method: "POST", body: JSON.stringify(req.body) },
  );
  res.json(result);
});

tournamentRouter.post("/:id/cancel", async (req, res) => {
  const result = await uplandFetch(
    `/rumble-tournaments/${req.params.id}/cancel`,
    { method: "POST" },
  );
  res.json(result);
});

module.exports = tournamentRouter;

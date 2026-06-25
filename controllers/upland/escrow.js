const escrowRouter = require("express").Router();
const { uplandFetch } = require("../../utils/uplandClient");

escrowRouter.post("/", async (req, res) => {
  const result = await uplandFetch("/containers", {
    method: "POST",
    body: JSON.stringify(req.body),
  });
  res.json(result);
});

escrowRouter.get("/:containerId", async (req, res) => {
  const result = await uplandFetch(`/containers/${req.params.containerId}`);
  res.json(result);
});

escrowRouter.post("/:containerId/refresh", async (req, res) => {
  const result = await uplandFetch(
    `/containers/${req.params.containerId}/refresh-expiration-time`,
    { method: "POST" },
  );
  res.json(result);
});

escrowRouter.post("/:containerId/lock", async (req, res) => {
  const result = await uplandFetch(
    `/containers/${req.params.containerId}/lock`,
    { method: "POST" },
  );
  res.json(result);
});

escrowRouter.post("/:containerId/resolve", async (req, res) => {
  const result = await uplandFetch(
    `/containers/${req.params.containerId}/resolve`,
    { method: "POST" },
  );
  res.json(result);
});

escrowRouter.post("/:containerId/refund", async (req, res) => {
  const result = await uplandFetch(
    `/containers/${req.params.containerId}/refund`,
    { method: "POST" },
  );
  res.json(result);
});

escrowRouter.delete(
  "/:containerId/transactions/:transactionId",
  async (req, res) => {
    const result = await uplandFetch(
      `/containers/${req.params.containerId}/transactions/${req.params.transactionId}`,
      { method: "DELETE" },
    );
    res.status(204).end();
  },
);

module.exports = escrowRouter;

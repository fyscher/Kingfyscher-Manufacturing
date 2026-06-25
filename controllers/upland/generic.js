const genericRouter = require("express").Router();
const { uplandFetch } = require("../../utils/uplandClient");

genericRouter.get("/cities", async (req, res) => {
  const result = await uplandFetch("/cities");
  res.json(result);
});

genericRouter.get("/properties", async (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  const result = await uplandFetch(`/properties${qs ? `?${qs}` : ""}`);
  res.json(result);
});

genericRouter.get("/properties/:propertyId", async (req, res) => {
  const result = await uplandFetch(`/properties/${req.params.propertyId}`);
  res.json(result);
});

genericRouter.get("/tracks", async (req, res) => {
  const result = await uplandFetch("/tracks");
  res.json(result);
});

genericRouter.get("/tracks/:id", async (req, res) => {
  const result = await uplandFetch(`/tracks/${req.params.id}`);
  res.json(result);
});

genericRouter.get("/tracks/:id/buildings", async (req, res) => {
  const result = await uplandFetch(`/tracks/${req.params.id}/buildings`);
  res.json(result);
});

genericRouter.get("/neighborhoods", async (req, res) => {
  const result = await uplandFetch("/neighborhoods");
  res.json(result);
});

genericRouter.get("/collections", async (req, res) => {
  const result = await uplandFetch("/collections");
  res.json(result);
});

genericRouter.get("/treasures-history", async (req, res) => {
  const result = await uplandFetch("/treasures-history");
  res.json(result);
});

genericRouter.post("/buildings", async (req, res) => {
  const result = await uplandFetch("/buildings", {
    method: "POST",
    body: JSON.stringify(req.body),
  });
  res.json(result);
});

module.exports = genericRouter;

const genericRouter = require("express").Router();
const { uplandFetch } = require("../../utils/uplandClient");

genericRouter.get("/cities", async (req, res) => {
  const result = await uplandFetch("/cities");
  res.json(result);
});

module.exports = genericRouter;

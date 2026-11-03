const uplandRouter = require("express").Router();
const authRouter = require("./upland/auth");
const genericRouter = require("./upland/generic");
const userRouter = require("./upland/user");
const escrowRouter = require("./upland/escrow");
const tournamentRouter = require("./upland/tournaments");
const appchainRouter = require("./upland/appchain");
const structuresRouter = require("./upland/structures");
const mapAssetsRouter  = require("./upland/mapAssets");
const optimizerRouter  = require("./upland/optimizer");
const floorsRouter     = require("./upland/floors");

uplandRouter.use("/auth", authRouter);
uplandRouter.use("/structures", structuresRouter);
uplandRouter.use("/", genericRouter);
uplandRouter.use("/user", userRouter);
uplandRouter.use("/containers", escrowRouter);
uplandRouter.use("/tournaments", tournamentRouter);
uplandRouter.use("/appchain", appchainRouter);
uplandRouter.use("/map-assets", mapAssetsRouter);
uplandRouter.use("/optimizer", optimizerRouter);
uplandRouter.use("/floors", floorsRouter);

module.exports = uplandRouter;

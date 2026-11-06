const uplandRouter = require("express").Router();
const authRouter = require("./upland/auth");
const genericRouter = require("./upland/generic");
const userRouter = require("./upland/user");
const escrowRouter = require("./upland/escrow");
const tournamentRouter = require("./upland/tournaments");
const structuresRouter = require("./upland/structures");
const optimizerRouter  = require("./upland/optimizer");
const floorsRouter     = require("./upland/floors");
const marketRouter     = require("./upland/market");
const appraiserRouter  = require("./upland/appraiser");

uplandRouter.use("/auth", authRouter);
uplandRouter.use("/structures", structuresRouter);
uplandRouter.use("/", genericRouter);
uplandRouter.use("/user", userRouter);
uplandRouter.use("/containers", escrowRouter);
uplandRouter.use("/tournaments", tournamentRouter);
uplandRouter.use("/optimizer", optimizerRouter);
uplandRouter.use("/floors", floorsRouter);
uplandRouter.use("/market", marketRouter);
uplandRouter.use("/appraiser", appraiserRouter);

module.exports = uplandRouter;

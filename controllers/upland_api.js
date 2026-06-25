const uplandRouter = require("express").Router();
const authRouter = require("./upland/auth");
const genericRouter = require("./upland/generic");
const userRouter = require("./upland/user");
const escrowRouter = require("./upland/escrow");
const tournamentRouter = require("./upland/tournaments");
const appchainRouter = require("./upland/appchain");

uplandRouter.use("/auth", authRouter);
uplandRouter.use("/", genericRouter);
uplandRouter.use("/user", userRouter);
uplandRouter.use("/containers", escrowRouter);
uplandRouter.use("/tournaments", tournamentRouter);
uplandRouter.use("/appchain", appchainRouter);

module.exports = uplandRouter;

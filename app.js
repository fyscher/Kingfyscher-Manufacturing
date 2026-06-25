const express = require("express");
const path = require("path");
const app = express();
const usersRouter = require("./controllers/users");
const loginRouter = require("./controllers/login");
const uplandRouter = require("./controllers/upland_api");
const middleware = require("./middleware");
const morgan = require("morgan");
const cors = require("cors");

morgan.token("body", (req) => JSON.stringify(req.body));

app.use(cors());
app.use(
  morgan(":method :url :status :res[content-length] - :response-time ms :body"),
);
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(middleware.tokenExtractor);

app.use("/api/users", usersRouter);
app.use("/api/login", loginRouter);
app.use("/api/upland", uplandRouter);

app.use(middleware.errorHandler);

module.exports = app;


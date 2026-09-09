const express = require("express");
const path = require("path");
const app = express();
const usersRouter = require("./controllers/users");
const loginRouter = require("./controllers/login");
const uplandRouter = require("./controllers/upland_api");
const middleware = require("./middleware");
const morgan = require("morgan");
const cors = require("cors");
const helmet = require("helmet");

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://unpkg.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
      },
    },
  }),
);
app.use(cors());
app.use(
  morgan(":method :url :status :res[content-length] - :response-time ms"),
);
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(middleware.tokenExtractor);

app.use("/api/users", usersRouter);
app.use("/api/login", loginRouter);
app.use("/api/upland", uplandRouter);

app.use(middleware.errorHandler);

module.exports = app;


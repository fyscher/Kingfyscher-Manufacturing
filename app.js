const express = require("express");
const path = require("path");
const app = express();

// Fly's proxy sits in front of this app and sets X-Forwarded-For with the
// real client IP — trust exactly that one hop so express-rate-limit (and
// anything else reading req.ip) sees the real client, not the proxy.
app.set("trust proxy", 1);
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


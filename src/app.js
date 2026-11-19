const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const config = require("./config");
const { requestId, notFound, errorHandler } = require("./middleware/errors");

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : "loopback"); // Render: TRUST_PROXY=1
  app.use(requestId);
  app.use(helmet({
    contentSecurityPolicy: { directives: {
      "default-src": ["'self'"], "script-src": ["'self'"],
      "style-src": ["'self'", "https://fonts.googleapis.com"], "font-src": ["'self'", "https://fonts.gstatic.com"],
      "img-src": ["'self'", "data:", "blob:"], "connect-src": ["'self'"], "style-src-attr": ["'unsafe-inline'"],
    } },
  }));
  app.use(express.json({ limit: "300kb" }));
  app.use(cookieParser());
  app.use("/api", rateLimit({ windowMs: 60e3, limit: config.env === "test" ? 10000 : 300, standardHeaders: "draft-7", legacyHeaders: false }));

  app.use("/api/auth", require("./routes/auth"));
  app.use("/api/profile", require("./routes/profile"));
  app.use("/api/objects", require("./routes/objects"));
  app.use("/api/observations", require("./routes/observations"));
  app.use("/api/events", require("./routes/events"));
  app.use("/api/galaxy", require("./routes/galaxy"));
  app.use("/api/assistant", require("./routes/assistant"));
  app.use("/api", require("./routes/plan"));
  app.use("/api", notFound);

  // The 3D orbits page is a single self-contained file with inline scripts: give it its own CSP.
  app.get("/orbits.html", (req, res, next) => {
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:");
    next();
  });
  app.use(express.static(path.join(__dirname, "..", "public"), { extensions: ["html"] }));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
module.exports = createApp;

const crypto = require("crypto");
const logger = require("../logger");

class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

function requestId(req, res, next) {
  req.id = crypto.randomBytes(6).toString("hex");
  res.setHeader("X-Request-Id", req.id);
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    if (!req.originalUrl.startsWith("/api")) return;
    logger.info("request", { id: req.id, method: req.method, path: req.originalUrl.split("?")[0],
      status: res.statusCode, ms: Number(process.hrtime.bigint() - start) / 1e6 });
  });
  next();
}

function notFound(req, res) {
  res.status(404).json({ error: "Not found" });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Malformed JSON body" });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
  if (err.code === "23505") return res.status(409).json({ error: "That record already exists" });
  if (err.code === "22P02") return res.status(400).json({ error: "Invalid identifier" });
  if (err.code === "23503") return res.status(400).json({ error: "Referenced record does not exist" });
  logger.error("unhandled", { id: req.id, err: err.message, stack: err.stack });
  res.status(500).json({ error: "Internal server error", requestId: req.id });
}

module.exports = { HttpError, requestId, notFound, errorHandler };

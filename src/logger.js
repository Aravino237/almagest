// Minimal structured logger: one JSON object per line.
const config = require("./config");
function log(level, msg, extra = {}) {
  if (config.env === "test" && level !== "error") return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra });
  (level === "error" ? console.error : console.log)(line);
}
module.exports = { info: (m, e) => log("info", m, e), warn: (m, e) => log("warn", m, e), error: (m, e) => log("error", m, e) };

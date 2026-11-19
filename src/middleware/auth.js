const jwt = require("jsonwebtoken");
const config = require("../config");
const { HttpError } = require("./errors");

function sign(user) {
  return jwt.sign({ sub: user.id, name: user.display_name }, config.jwtSecret, { expiresIn: config.jwtTtlSeconds });
}

function readUser(req) {
  const token = req.cookies?.[config.cookieName];
  if (!token) return null;
  try {
    const p = jwt.verify(token, config.jwtSecret);
    return { id: p.sub, name: p.name };
  } catch { return null; }
}

const optionalAuth = (req, res, next) => { req.user = readUser(req); next(); };
const requireAuth = (req, res, next) => {
  req.user = readUser(req);
  if (!req.user) return next(new HttpError(401, "Sign in required"));
  next();
};

function setAuthCookie(res, token) {
  res.cookie(config.cookieName, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "1" : config.env === "production", // COOKIE_SECURE=0 allows login over plain HTTP (demo on a bare EC2 IP)
    maxAge: config.jwtTtlSeconds * 1000, path: "/",
  });
}

module.exports = { sign, optionalAuth, requireAuth, setAuthCookie };

const { HttpError } = require("./errors");
// validate(schema, "body" | "query" | "params") -> replaces req[where] with the parsed value
module.exports = (schema, where = "body") => (req, res, next) => {
  const r = schema.safeParse(req[where] ?? {});
  if (!r.success) {
    const details = r.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
    return next(new HttpError(400, "Validation failed", details));
  }
  if (where === "query") req.validQuery = r.data; else req[where] = r.data;
  next();
};

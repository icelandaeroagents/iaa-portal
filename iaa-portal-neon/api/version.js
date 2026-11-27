/* Iceland Aero Agents – Staff Portal
   GET /api/version – which deployment is live. It changes with every upload,
   so an open portal can tell it has been updated and refresh itself. */
module.exports = function handler(req, res) {
  const version = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_URL || "local";
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({ version: version }));
};

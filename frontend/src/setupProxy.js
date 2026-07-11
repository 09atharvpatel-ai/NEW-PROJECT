// Proxies API requests from the CRA dev server to the FastAPI backend.
// This lets the browser talk to the backend through the single exposed
// preview origin (same-origin /api/* -> http://localhost:8001/api/*).
const { createProxyMiddleware } = require("http-proxy-middleware");

module.exports = function (app) {
  app.use(
    "/api",
    createProxyMiddleware({
      target: "http://localhost:8001",
      changeOrigin: true,
      ws: false,
      logLevel: "warn",
    })
  );
};

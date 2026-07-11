// Proxies API requests from the CRA dev server to the FastAPI backend AND
// keeps the backend alive. Because v0 auto-manages the frontend dev server
// (but not the Python process), we spawn/adopt the backend here so the
// waitlist API is always up whenever the site is up.
const { createProxyMiddleware } = require("http-proxy-middleware");
const { spawn } = require("child_process");
const net = require("net");
const path = require("path");
const fs = require("fs");

const BACKEND_PORT = 8001;
const BACKEND_DIR = path.resolve(__dirname, "..", "..", "backend");

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.setTimeout(800, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

let launching = false;
async function ensureBackend() {
  if (launching) return;
  if (await isPortOpen(BACKEND_PORT)) return;
  launching = true;

  const venvPy = path.join(BACKEND_DIR, ".venv", "bin", "python");
  const python = fs.existsSync(venvPy) ? venvPy : "python3";
  const logPath = path.join(BACKEND_DIR, "backend.log");
  const out = fs.openSync(logPath, "a");

  console.log(`[v0] Starting FastAPI backend on :${BACKEND_PORT} (${python})`);
  const child = spawn(
    python,
    ["-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", String(BACKEND_PORT)],
    { cwd: BACKEND_DIR, env: process.env, stdio: ["ignore", out, out], detached: true }
  );
  child.on("error", (err) => {
    console.log(`[v0] Failed to start backend: ${err.message}`);
    launching = false;
  });
  child.unref();
}

module.exports = function (app) {
  ensureBackend();
  // Re-check periodically so a crashed backend gets relaunched automatically.
  setInterval(() => {
    isPortOpen(BACKEND_PORT).then((open) => {
      if (!open) {
        launching = false;
        ensureBackend();
      }
    });
  }, 5000);

  app.use(
    "/api",
    createProxyMiddleware({
      target: `http://localhost:${BACKEND_PORT}`,
      changeOrigin: true,
      ws: false,
      logLevel: "warn",
      onError(err, req, res) {
        // Backend still booting — respond gracefully instead of crashing the request.
        if (!res.headersSent) {
          res.writeHead(503, { "Content-Type": "application/json" });
        }
        res.end(JSON.stringify({ detail: "Backend starting, please retry." }));
      },
    })
  );
};

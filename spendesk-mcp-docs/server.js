#!/usr/bin/env node
/**
 * Railway (and other PaaS) expect the app to listen on process.env.PORT.
 * Mintlify dev listens on 3000. This script starts Mintlify and proxies
 * requests from PORT to 3000.
 */
const { spawn } = require("child_process");
const http = require("http");
const httpProxy = require("http-proxy");

const PORT = Number(process.env.PORT) || 3000;
const MINTLIFY_PORT = 3000;

const mint = spawn("npx", ["mintlify", "dev", "--no-open"], {
  stdio: "inherit",
  env: { ...process.env, PORT: String(MINTLIFY_PORT) },
  shell: true,
});

mint.on("error", (err) => {
  console.error("Failed to start Mintlify:", err);
  process.exit(1);
});

mint.on("exit", (code) => {
  process.exit(code ?? 1);
});

const proxy = httpProxy.createProxyServer({});
const server = http.createServer((req, res) => {
  proxy.web(req, res, {
    target: `http://127.0.0.1:${MINTLIFY_PORT}`,
  });
});

proxy.on("error", (err, req, res) => {
  console.error("Proxy error:", err.message);
  if (res && !res.headersSent) {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Documentation server is starting...");
  }
});

server.on("upgrade", (req, socket, head) => {
  proxy.ws(req, socket, head, {
    target: `http://127.0.0.1:${MINTLIFY_PORT}`,
  });
});

// Wait for Mintlify to be ready then listen on PORT (only once)
let listened = false;
function tryListen() {
  if (listened) return;
  const req = http.get(
    `http://127.0.0.1:${MINTLIFY_PORT}/`,
    { timeout: 2000 },
    () => {
      if (listened) return;
      listened = true;
      server.listen(PORT, "0.0.0.0", () => {
        console.log(`Docs proxy listening on 0.0.0.0:${PORT} → localhost:${MINTLIFY_PORT}`);
      });
    }
  );
  req.on("error", () => {
    setTimeout(tryListen, 2000);
  });
  req.on("timeout", () => {
    req.destroy();
    setTimeout(tryListen, 2000);
  });
}

setTimeout(tryListen, 8000);

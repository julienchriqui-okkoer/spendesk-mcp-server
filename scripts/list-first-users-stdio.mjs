#!/usr/bin/env node
/**
 * Affiche les 5 premiers users via le MCP (stdio). Lance le serveur automatiquement.
 * Usage: node -r dotenv/config scripts/list-first-users-stdio.mjs
 */
import { spawn } from "child_process";

const token = process.env.SPENDESK_API_TOKEN;
if (!token) {
  console.error("Set SPENDESK_API_TOKEN (e.g. .env ou -r dotenv/config).");
  process.exit(1);
}

const server = spawn("node", ["dist/index.js"], {
  env: { ...process.env, SPENDESK_API_TOKEN: token },
  stdio: ["pipe", "pipe", "inherit"],
});

let buffer = "";
let done = false;

function send(msg) {
  server.stdin.write(JSON.stringify(msg) + "\n");
}

server.stdout.setEncoding("utf8");
server.stdout.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.result?.serverInfo && !done) {
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
        send({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "spendesk_get_users", arguments: { page: 1, perPage: 5 } },
        });
        return;
      }
      if (msg.result?.content && msg.result?.content?.length) {
        done = true;
        server.kill();
        const text = msg.result.content[0].text;
        let users = [];
        try {
          const data = JSON.parse(text);
          users = data.data ?? data.users ?? (Array.isArray(data) ? data : []);
        } catch {}
        if (!Array.isArray(users)) users = [];
        users = users.slice(0, 5);
        console.log("--- 5 premiers users ---\n");
        const row = (u) => ({
          id: (u.id ?? "-").toString().slice(0, 14),
          name: ((u.name ?? u.display_name ?? ((u.firstName || "") + " " + (u.lastName || "")).trim()) || "-").toString().slice(0, 28),
          email: (u.email ?? "-").toString().slice(0, 32),
        });
        const rows = users.map(row);
        const w = { id: 14, name: 28, email: 32 };
        console.log("| ID            | Nom                         | Email                          |");
        console.log("| " + "-".repeat(14) + " | " + "-".repeat(28) + " | " + "-".repeat(32) + " |");
        rows.forEach((r) => console.log("| " + r.id.padEnd(14) + " | " + r.name.padEnd(28) + " | " + r.email.padEnd(32) + " |"));
        console.log("\n--- Détail ---\n");
        users.forEach((u, i) => {
          console.log(`### User ${i + 1}`);
          console.log(JSON.stringify(u, null, 2));
          console.log("");
        });
        process.exit(0);
        return;
      }
      if (msg.error) {
        done = true;
        server.kill();
        console.error("Erreur:", msg.error.message ?? msg.error);
        process.exit(1);
      }
    } catch (_) {}
  }
});

server.on("error", (err) => {
  console.error(err.message);
  process.exit(1);
});
setTimeout(() => {
  if (!done) {
    server.kill();
    console.error("Timeout");
    process.exit(1);
  }
}, 15000);

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "list-first-users", version: "1.0.0" },
  },
});

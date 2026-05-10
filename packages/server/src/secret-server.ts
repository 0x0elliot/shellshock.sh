#!/usr/bin/env node

import net from "node:net";
import http from "node:http";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import express from "express";
import { opensslEncrypt, generatePassword, generateAuthId } from "./crypto.js";

// --- Args ---

const argv = process.argv.slice(2);

function getFlag(name: string, fallback: string): string {
  const i = argv.indexOf(name);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : fallback;
}

const requestedPort = parseInt(getFlag("--port", "4801"), 10);
const ttlMinutes = parseInt(getFlag("--ttl", "15"), 10);
const noTunnel = argv.includes("--no-tunnel");

// --- Secret store (memory only — nothing touches disk) ---

interface Entry {
  blob: string;
  expiresAt: number;
}

const store = new Map<string, Entry>();

// --- Networking helpers ---

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "0.0.0.0", () => srv.close(() => resolve(true)));
  });
}

async function findFreePort(start: number): Promise<number> {
  for (let p = start; p < start + 20; p++) {
    if (await isPortFree(p)) return p;
  }
  throw new Error(`No free port in range ${start}–${start + 19}`);
}

// --- ngrok helpers ---

function hasNgrok(): boolean {
  try {
    execSync("ngrok version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function startNgrok(port: number): ChildProcess {
  return spawn("ngrok", ["http", String(port)], {
    stdio: "ignore",
    detached: false,
  });
}

function fetchNgrokUrl(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = http.get("http://127.0.0.1:4040/api/tunnels", (res) => {
      let data = "";
      res.on("data", (chunk: string) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const tunnels = JSON.parse(data).tunnels as {
            public_url: string;
            proto: string;
          }[];
          const https = tunnels.find((t) => t.proto === "https");
          resolve(https?.public_url ?? tunnels[0]?.public_url ?? null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function waitForNgrok(retries = 10): Promise<string | null> {
  for (let i = 0; i < retries; i++) {
    const url = await fetchNgrokUrl();
    if (url) return url;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

// --- Read secret from stdin ---

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").trimEnd();
}

// --- Main ---

async function main() {
  if (process.stdin.isTTY) {
    process.stderr.write("\n  Enter secret (then Ctrl+D):\n\n  ");
  }
  const secret = await readStdin();

  if (!secret) {
    console.error("  Error: no secret provided.");
    process.exit(1);
  }

  if (secret.length > 1_000_000) {
    console.error("  Error: secret too large (max 1 MB).");
    process.exit(1);
  }

  const authId = generateAuthId();
  const decryptKey = generatePassword();
  const blob = opensslEncrypt(secret + "\n", decryptKey);

  store.set(authId, {
    blob,
    expiresAt: Date.now() + ttlMinutes * 60_000,
  });

  // --- HTTP server ---

  const app = express();
  app.set("trust proxy", "loopback");

  app.get("/s/:authId", (req, res) => {
    if (req.headers["x-shellshock"] !== "1") {
      res.status(404).type("text").send("Not found.\n");
      return;
    }

    const entry = store.get(req.params.authId);

    if (!entry) {
      res.status(404).type("text").send("Not found or already retrieved.\n");
      return;
    }

    if (entry.expiresAt < Date.now()) {
      store.delete(req.params.authId);
      res.status(410).type("text").send("Secret expired.\n");
      return;
    }

    // Burn after reading
    store.delete(req.params.authId);
    res.type("text").send(entry.blob + "\n");

    const rawIp = req.ip || req.socket.remoteAddress || "unknown";
    const ip = rawIp.replace(/^::ffff:/, "");
    console.log(`\n  Retrieved by ${ip}`);
    console.log("  Shutting down.\n");
    clearTimeout(expiryTimeout);
    setTimeout(() => shutdown(0), 300);
  });

  app.get("/", (_req, res) => {
    res.type("text").send(
      "shellshock.sh secret share\n\nUse the retrieval command provided by the sender.\n"
    );
  });

  // --- Start ---

  let port = requestedPort;
  if (!(await isPortFree(port))) {
    port = await findFreePort(port + 1);
  }

  let ngrokProcess: ChildProcess | null = null;
  let tunnelUrl: string | null = null;

  if (!noTunnel && hasNgrok()) {
    ngrokProcess = startNgrok(port);
  }

  const server = app.listen(port, "0.0.0.0", async () => {
    const localUrl = `http://localhost:${port}`;

    if (ngrokProcess) {
      tunnelUrl = await waitForNgrok();
      if (!tunnelUrl) {
        console.log(
          "  ngrok detected but tunnel failed — using local URL\n"
        );
      }
    }

    const baseUrl = tunnelUrl ?? localUrl;
    const fetchUrl = `${baseUrl}/s/${authId}`;

    console.log("");
    console.log("  shellshock.sh secret share");
    console.log("  ──────────────────────────");
    console.log("");
    console.log(`  Secret encrypted (${secret.length} bytes)`);
    console.log("");
    console.log("  Recipient command:");
    console.log("");
    console.log(
      `    curl -sL shellshock.sh/secret | bash -s -- ${fetchUrl} ${decryptKey}`
    );
    console.log("");
    console.log("  Or directly (Unix/macOS):");
    console.log("");
    console.log(
      `    curl -sf -H "X-Shellshock: 1" -H "ngrok-skip-browser-warning: 1" \\\n      ${fetchUrl} \\\n      | openssl enc -aes-256-cbc -d -a -md sha256 \\\n        -pass fd:3 3<<<'${decryptKey}' 2>/dev/null \\\n      || echo "Error: secret not found or already retrieved"`
    );
    console.log("");
    console.log("  Windows (PowerShell):");
    console.log("");
    console.log(
      `    curl.exe -sf -H "X-Shellshock: 1" -H "ngrok-skip-browser-warning: 1" \`\n      ${fetchUrl} \`\n      | openssl enc -aes-256-cbc -d -a -md sha256 \`\n        -pass pass:${decryptKey} 2>$null`
    );
    console.log("");
    console.log(
      `  Expires in ${ttlMinutes} minutes  |  Burns after first retrieval`
    );
    console.log(
      "  Decryption key never reaches the server"
    );
    console.log("");
    console.log("  Waiting for retrieval... (Ctrl+C to cancel)");
  });

  // --- Expiry timer ---

  const expiryTimeout = setTimeout(() => {
    store.delete(authId);
    console.log("\n  Expired — secret was not retrieved.");
    console.log("  Shutting down.\n");
    shutdown(0);
  }, ttlMinutes * 60_000);

  // --- Shutdown ---

  function shutdown(code: number) {
    if (ngrokProcess) {
      ngrokProcess.kill();
      ngrokProcess = null;
    }
    server.close(() => process.exit(code));
    setTimeout(() => process.exit(code), 3000);
  }

  process.on("SIGINT", () => {
    store.delete(authId);
    console.log("\n  Cancelled. Secret destroyed.\n");
    shutdown(0);
  });
  process.on("SIGTERM", () => {
    store.delete(authId);
    shutdown(0);
  });
}

main().catch((err) => {
  console.error(`  Error: ${err.message}`);
  process.exit(1);
});

#!/usr/bin/env node

import net from "node:net";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import { createServer } from "./http.js";
import { SessionManager } from "./session-manager.js";
import { SecretStore } from "./secret-store.js";

const args = process.argv.slice(2);

function getArg(name: string, defaultValue: string): string {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return defaultValue;
}

function isPortFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, host, () => srv.close(() => resolve(true)));
  });
}

async function findFreePort(start: number, host: string): Promise<number> {
  for (let p = start; p < start + 20; p++) {
    if (await isPortFree(p, host)) return p;
  }
  throw new Error(`No free port found in range ${start}-${start + 19}`);
}

function hasNgrok(): boolean {
  try {
    execSync("ngrok version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function startNgrok(port: number): ChildProcess {
  const child = spawn("ngrok", ["http", String(port)], {
    stdio: "ignore",
    detached: false,
  });
  return child;
}

function fetchNgrokUrl(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = http.get("http://127.0.0.1:4040/api/tunnels", (res) => {
      let data = "";
      res.on("data", (chunk: string) => { data += chunk; });
      res.on("end", () => {
        try {
          const tunnels = JSON.parse(data).tunnels as { public_url: string; proto: string }[];
          const https = tunnels.find((t) => t.proto === "https");
          resolve(https?.public_url ?? tunnels[0]?.public_url ?? null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(2000, () => { req.destroy(); resolve(null); });
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

const DEFAULT_PORT = 4800;
const requestedPort = parseInt(getArg("--port", String(DEFAULT_PORT)), 10);
const host = getArg("--host", "0.0.0.0");
const noTui = args.includes("--no-tui");
const noTunnel = args.includes("--no-tunnel");
const explicitPort = args.includes("--port");

async function main() {
  let port = requestedPort;

  if (!(await isPortFree(port, host))) {
    if (explicitPort) {
      console.error(`Error: port ${port} is already in use.`);
      process.exit(1);
    }
    const freePort = await findFreePort(port + 1, host);
    console.log(`Port ${port} in use, using ${freePort}`);
    port = freePort;
  }

  let ngrokProcess: ChildProcess | null = null;
  let tunnelUrl: string | null = null;

  if (!noTunnel && hasNgrok()) {
    ngrokProcess = startNgrok(port);
  }

  const sessionManager = new SessionManager();
  const secretStore = new SecretStore();
  const { app, engineerToken } = createServer(sessionManager, secretStore);

  const server = app.listen(port, host, async () => {
    const localUrl = `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`;

    if (ngrokProcess) {
      tunnelUrl = await waitForNgrok();
      if (!tunnelUrl) {
        console.log("  ngrok detected but tunnel failed to start — using local URL");
      }
    }

    const displayHost = tunnelUrl
      ? new URL(tunnelUrl).host
      : (host === "0.0.0.0" ? "localhost" : host);
    const displayPort = tunnelUrl ? (new URL(tunnelUrl).port || (tunnelUrl.startsWith("https") ? 443 : 80)) : port;

    if (noTui || !process.stdin.isTTY) {
      console.log(`shellshock.sh server running at ${tunnelUrl ?? localUrl}`);
      console.log(`Engineer token: ${engineerToken}`);
      console.log("");
      console.log("Create a session:");
      console.log(
        `  curl -X POST ${tunnelUrl ?? localUrl}/api/sessions -H "Authorization: Bearer ${engineerToken}" -H "Content-Type: application/json" -d '{"label":"my-session"}'`
      );
      console.log("");
      console.log("Press Ctrl+C to stop.");
    } else {
      try {
        const { render } = await import("ink");
        const { default: React } = await import("react");
        const { App } = await import("./app.js");

        render(
          React.createElement(App, {
            sessionManager,
            secretStore,
            host: displayHost,
            port: Number(displayPort),
            tunnelUrl: tunnelUrl ?? undefined,
          }),
          { exitOnCtrlC: false }
        );
      } catch (err) {
        console.error("Failed to start TUI, falling back to headless mode:", err);
        console.log(`shellshock.sh server running at ${tunnelUrl ?? localUrl}`);
        console.log("Press Ctrl+C to stop.");
      }
    }
  });

  function shutdown() {
    if (ngrokProcess) {
      ngrokProcess.kill();
      ngrokProcess = null;
    }

    for (const session of sessionManager.getActiveSessions()) {
      sessionManager.closeSession(session.id);
    }

    server.close(() => {
      process.exit(0);
    });

    setTimeout(() => {
      process.exit(1);
    }, 5000);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

#!/usr/bin/env node

import net from "node:net";
import { createServer } from "./http.js";
import { SessionManager } from "./session-manager.js";

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

const DEFAULT_PORT = 4800;
const requestedPort = parseInt(getArg("--port", String(DEFAULT_PORT)), 10);
const host = getArg("--host", "0.0.0.0");
const noTui = args.includes("--no-tui");
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

  const sessionManager = new SessionManager();
  const app = createServer(sessionManager);

  const server = app.listen(port, host, async () => {
    const serverUrl = `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`;

    if (noTui || !process.stdin.isTTY) {
      console.log(`shellshock.sh server running at ${serverUrl}`);
      console.log("");
      console.log("Create a session:");
      console.log(
        `  curl -X POST ${serverUrl}/api/sessions -H "Content-Type: application/json" -d '{"label":"my-session"}'`
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
            host: host === "0.0.0.0" ? "localhost" : host,
            port,
          }),
          { exitOnCtrlC: false }
        );
      } catch (err) {
        console.error("Failed to start TUI, falling back to headless mode:", err);
        console.log(`shellshock.sh server running at ${serverUrl}`);
        console.log("Press Ctrl+C to stop.");
      }
    }
  });

  function shutdown() {
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

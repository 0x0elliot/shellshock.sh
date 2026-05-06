#!/usr/bin/env node

import { createServer } from "./http.js";
import { SessionManager } from "./session-manager.js";

// Parse CLI args
const args = process.argv.slice(2);

function getArg(name: string, defaultValue: string): string {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return defaultValue;
}

const port = parseInt(getArg("--port", "3000"), 10);
const host = getArg("--host", "0.0.0.0");
const noTui = args.includes("--no-tui");

const sessionManager = new SessionManager();
const app = createServer(sessionManager);

const server = app.listen(port, host, async () => {
  const serverUrl = `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`;

  if (noTui) {
    // Headless mode
    console.log(`Remote Debugger server running at ${serverUrl}`);
    console.log("");
    console.log("Create a session:");
    console.log(
      `  curl -X POST ${serverUrl}/api/sessions -H "Content-Type: application/json" -d '{"label":"my-session"}'`
    );
    console.log("");
    console.log("Press Ctrl+C to stop.");
  } else {
    // TUI mode
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
      // Fallback to headless if ink fails
      console.error("Failed to start TUI, falling back to headless mode:", err);
      console.log(`Remote Debugger server running at ${serverUrl}`);
      console.log("Press Ctrl+C to stop.");
    }
  }
});

// Graceful shutdown
function shutdown() {
  console.log("\nShutting down...");

  // Close all sessions
  for (const session of sessionManager.getActiveSessions()) {
    sessionManager.closeSession(session.id);
  }

  server.close(() => {
    process.exit(0);
  });

  // Force exit after 5s
  setTimeout(() => {
    process.exit(1);
  }, 5000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

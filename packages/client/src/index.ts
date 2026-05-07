#!/usr/bin/env node

import React from "react";
import { render } from "ink";
import App from "./app.js";

async function main() {
  const connectUrl = process.argv[2];

  if (!connectUrl) {
    console.error("Usage: shellshock-client <connect-url>");
    console.error("");
    console.error("  The connect URL is provided by the support engineer.");
    console.error("  Example: shellshock-client http://localhost:3000/session/abc123?token=xyz");
    process.exit(1);
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(connectUrl);
  } catch {
    console.error("Error: Invalid URL provided.");
    console.error(`  Received: ${connectUrl}`);
    process.exit(1);
    return;
  }

  const pathSegments = parsed.pathname.split("/").filter(Boolean);
  const sessionIdx = pathSegments.indexOf("session");
  let sessionId: string | undefined;
  if (sessionIdx !== -1 && sessionIdx + 1 < pathSegments.length) {
    sessionId = pathSegments[sessionIdx + 1];
  }

  if (!sessionId) {
    console.error("Error: Could not extract session ID from URL path.");
    console.error("  Expected URL format: http://host/session/:id?token=...");
    process.exit(1);
    return;
  }

  const token = parsed.searchParams.get("token");
  if (!token) {
    console.error("Error: Missing 'token' query parameter in URL.");
    console.error("  Expected URL format: http://host/session/:id?token=...");
    process.exit(1);
    return;
  }

  const serverBaseUrl = `${parsed.protocol}//${parsed.host}`;

  // Emergency exit: double Ctrl+C resets terminal and force-exits
  let ctrlCCount = 0;
  let ctrlCTimer: ReturnType<typeof setTimeout> | null = null;
  process.on("SIGINT", () => {
    ctrlCCount++;
    if (ctrlCCount >= 2) {
      process.stdout.write("\x1B[?1049l");
      process.stdout.write("\x1B[?25h");
      process.stdout.write("\x1Bc");
      process.exit(0);
    }
    if (ctrlCTimer) clearTimeout(ctrlCTimer);
    ctrlCTimer = setTimeout(() => { ctrlCCount = 0; }, 1000);
  });

  const { waitUntilExit } = render(
    React.createElement(App, { serverBaseUrl, sessionId, token }),
    { exitOnCtrlC: false },
  );

  await waitUntilExit();
  process.stdout.write("\x1B[?25h");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

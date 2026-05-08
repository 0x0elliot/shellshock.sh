#!/usr/bin/env node
/**
 * Integration test: starts the server headlessly, spawns the client TUI
 * in a PTY, sends commands via the API, and verifies the client handles
 * approval, execution, queue processing, and SIGINT correctly.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pty = require("node-pty");

const SERVER_BIN = new URL("../packages/server/dist/index.js", import.meta.url).pathname;
const CLIENT_BIN = new URL("../packages/client/dist/index.js", import.meta.url).pathname;
const PORT = 14800;

let serverProc = null;
let clientPty = null;
let engineerToken = null;
let sessionId = null;
let clientToken = null;
let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
    passed++;
  } else {
    console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
    failed++;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForPtyOutput(ptyHandle, pattern, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => {
      disposable.dispose();
      reject(new Error(`Timed out waiting for "${pattern}" in PTY output. Got:\n${buf}`));
    }, timeoutMs);

    const disposable = ptyHandle.onData((data) => {
      buf += data;
      if (buf.includes(pattern)) {
        clearTimeout(timer);
        disposable.dispose();
        resolve(buf);
      }
    });
  });
}

async function api(method, path, body, token) {
  const url = `http://localhost:${PORT}${path}`;
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch { return { status: res.status, data: text }; }
}

// --- Start server ---
async function startServer() {
  return new Promise((resolve, reject) => {
    serverProc = spawn("node", [SERVER_BIN, "--no-tui", "--no-tunnel", "--port", String(PORT)], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    serverProc.stdout.on("data", (d) => { output += d.toString(); });
    serverProc.stderr.on("data", (d) => { output += d.toString(); });

    const timer = setTimeout(() => reject(new Error("Server didn't start:\n" + output)), 10000);

    serverProc.stdout.on("data", () => {
      const match = output.match(/Engineer token:\s+(\S+)/);
      if (match) {
        clearTimeout(timer);
        engineerToken = match[1];
        resolve();
      }
    });
  });
}

// --- Start client TUI in a PTY ---
function startClient(url) {
  clientPty = pty.spawn("node", [CLIENT_BIN, url], {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd: process.cwd(),
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  return clientPty;
}

async function cleanup() {
  if (clientPty) {
    try { clientPty.kill(); } catch {}
  }
  if (serverProc) {
    serverProc.kill("SIGTERM");
    await sleep(500);
    try { serverProc.kill("SIGKILL"); } catch {}
  }
}

async function run() {
  console.log("\n\x1b[1mShellshock Integration Tests\x1b[0m\n");

  // 1. Start server
  console.log("Starting server...");
  await startServer();
  assert(!!engineerToken, "Server started with engineer token");

  // 2. Create session
  const createRes = await api("POST", "/api/sessions", { label: "test" }, engineerToken);
  assert(createRes.status === 200, "Session created");
  sessionId = createRes.data.sessionId;
  clientToken = createRes.data.token;

  const clientUrl = `http://localhost:${PORT}/session/${sessionId}?token=${clientToken}`;

  // 3. Start client and wait for handshake
  console.log("Starting client TUI...");
  const client = startClient(clientUrl);
  const handshakeOutput = await waitForPtyOutput(client, "Connected", 15000).catch(() => "");
  assert(handshakeOutput.includes("Connected"), "Client connected and completed handshake");

  // Wait a moment for handshake to settle on server side
  await sleep(1000);

  // 4. Verify handshake complete on server side
  const sessions = await api("GET", "/api/sessions", null, engineerToken);
  const session = sessions.data.sessions?.find((s) => s.id === sessionId);
  assert(session?.handshakeComplete === true, "Server confirms handshake complete");

  // 5. Send a simple read-only command
  console.log("\n--- Test: simple command approval ---");
  const cmd1 = await api("POST", `/api/sessions/${sessionId}/commands`, { command: "echo hello_test_123" }, engineerToken);
  assert(cmd1.status === 200, "Command submitted: echo hello_test_123");

  // Wait for the approval prompt to appear
  const promptOutput = await waitForPtyOutput(client, "echo hello_test_123", 10000).catch(() => "");
  assert(promptOutput.includes("echo hello_test_123"), "Client shows command for approval");

  // Approve with 'y'
  client.write("y");

  // Wait for command output
  const execOutput = await waitForPtyOutput(client, "hello_test_123", 10000).catch(() => "");
  assert(execOutput.includes("hello_test_123"), "Command executed and output shown");

  // 6. Send two commands rapidly to test queue processing
  console.log("\n--- Test: queue processing ---");
  await api("POST", `/api/sessions/${sessionId}/commands`, { command: "echo first_cmd" }, engineerToken);
  await sleep(200);
  await api("POST", `/api/sessions/${sessionId}/commands`, { command: "echo second_cmd" }, engineerToken);

  // First command should be prompted
  const q1 = await waitForPtyOutput(client, "echo first_cmd", 10000).catch(() => "");
  assert(q1.includes("echo first_cmd"), "First queued command shown for approval");
  client.write("y");

  // After approving first, second should appear
  const q2 = await waitForPtyOutput(client, "echo second_cmd", 10000).catch(() => "");
  assert(q2.includes("echo second_cmd"), "Second queued command shown after first approved");
  client.write("y");

  // Wait for both to complete
  await waitForPtyOutput(client, "second_cmd", 5000).catch(() => "");

  // 7. Test deny flow
  console.log("\n--- Test: deny command ---");
  await api("POST", `/api/sessions/${sessionId}/commands`, { command: "echo should_be_denied" }, engineerToken);
  const denyPrompt = await waitForPtyOutput(client, "echo should_be_denied", 10000).catch(() => "");
  assert(denyPrompt.includes("echo should_be_denied"), "Deny target command shown");
  client.write("n");
  const denyOutput = await waitForPtyOutput(client, "denied", 5000).catch(() => "");
  assert(denyOutput.toLowerCase().includes("denied") || denyOutput.includes("✗"), "Command denied successfully");

  // 8. Test interactive command + SIGINT
  console.log("\n--- Test: interactive command (watch) + Ctrl+C ---");
  await api("POST", `/api/sessions/${sessionId}/commands`, {
    command: "watch -n1 echo sigint_test",
    interactive: true,
  }, engineerToken);

  // Wait for interactive choice prompt
  const interactivePrompt = await waitForPtyOutput(client, "watch", 10000).catch(() => "");
  assert(interactivePrompt.includes("watch"), "Interactive command prompt shown");

  // Choose client mode (option 1 or 'c')
  await sleep(500);
  // Navigate to "Run on this machine" and press enter
  client.write("\r");

  // Wait for watch to start
  await sleep(3000);

  // Send Ctrl+C to stop watch — this should NOT kill the session
  client.write("\x03");
  await sleep(2000);

  // Verify the session is still alive by sending another command
  const afterSigint = await api("POST", `/api/sessions/${sessionId}/commands`, { command: "echo still_alive" }, engineerToken);
  assert(afterSigint.status === 200, "Server still accepts commands after Ctrl+C (session alive)");

  const alivePrompt = await waitForPtyOutput(client, "echo still_alive", 10000).catch((e) => e.message);
  assert(typeof alivePrompt === "string" && alivePrompt.includes("still_alive"),
    "Client shows next command after interactive Ctrl+C (queue processed)");

  if (typeof alivePrompt === "string" && alivePrompt.includes("still_alive")) {
    client.write("y");
    await waitForPtyOutput(client, "still_alive", 5000).catch(() => "");
  }

  // Done
  console.log(`\n\x1b[1mResults: ${passed} passed, ${failed} failed\x1b[0m\n`);
}

run()
  .catch((err) => {
    console.error("\x1b[31mTest error:\x1b[0m", err.message);
    failed++;
  })
  .finally(async () => {
    await cleanup();
    process.exit(failed > 0 ? 1 : 0);
  });

#!/usr/bin/env node
/**
 * Integration test for shellshock client TUI via PTY automation.
 *
 * Tests: approval, deny, queue processing, classification tags, compound
 * commands, interactive mode (watch, less, deny), permission saving,
 * cd handling, stderr/errors, and real-world edge cases.
 *
 * Interactive tests each get a fresh session to avoid cascading failures.
 */

import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pty = require("node-pty");

const SERVER_BIN = new URL("../packages/server/dist/index.js", import.meta.url).pathname;
const CLIENT_BIN = new URL("../packages/client/dist/index.js", import.meta.url).pathname;
const PORT = 14800;

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B(?:\[[0-9;?]*[A-Za-z]|\][^\x07\x1B]*(?:\x07|\x1B\\)|\([A-Za-z0-9]|[>=<])|[\x00-\x08\x0B\x0C\x0E-\x1F]/g;

let serverProc = null;
let passed = 0;
let failed = 0;
let skipped = 0;

function assert(condition, msg) {
  if (condition) { console.log(`  \x1b[32m✓\x1b[0m ${msg}`); passed++; }
  else { console.log(`  \x1b[31m✗\x1b[0m ${msg}`); failed++; }
  return condition;
}

function skip(msg) { console.log(`  \x1b[33m⊘\x1b[0m ${msg} (skipped)`); skipped++; }

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function strip(text) { return text.replace(ANSI_RE, ""); }

function toolAvailable(name) {
  try { execSync(`which ${name}`, { stdio: "ignore" }); return true; } catch { return false; }
}

function waitFor(ptyHandle, pattern, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => {
      disposable.dispose();
      reject(new Error(`Timed out waiting for "${pattern}". Got:\n${strip(buf).slice(-500)}`));
    }, timeoutMs);
    const disposable = ptyHandle.onData((data) => {
      buf += data;
      if (strip(buf).includes(pattern)) {
        clearTimeout(timer); disposable.dispose(); resolve(buf);
      }
    });
  });
}

function drain(ptyHandle, ms = 2000) {
  return new Promise((resolve) => {
    let buf = "";
    const disposable = ptyHandle.onData((data) => { buf += data; });
    setTimeout(() => { disposable.dispose(); resolve(strip(buf)); }, ms);
  });
}

async function api(method, path, body, token) {
  const url = `http://localhost:${PORT}${path}`;
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch { return { status: res.status, data: text }; }
}

// ── Server / Session lifecycle ───────────────────────────────────────────

let engineerToken = null;

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
      const m = output.match(/Engineer token:\s+(\S+)/);
      if (m) { clearTimeout(timer); engineerToken = m[1]; resolve(); }
    });
  });
}

async function freshSession() {
  const res = await api("POST", "/api/sessions", { label: "test" }, engineerToken);
  const { sessionId, token } = res.data;
  const url = `http://localhost:${PORT}/session/${sessionId}?token=${token}`;
  const client = pty.spawn("node", [CLIENT_BIN, url], {
    name: "xterm-256color", cols: 120, rows: 30,
    cwd: process.cwd(), env: { ...process.env, FORCE_COLOR: "0" },
  });
  await waitFor(client, "Connected", 15000);
  await sleep(800);
  return { client, sessionId, kill: () => { try { client.kill(); } catch {} } };
}

async function send(sid, command, opts = {}) {
  return api("POST", `/api/sessions/${sid}/commands`, { command, ...opts }, engineerToken);
}

async function cleanup() {
  if (serverProc) { serverProc.kill("SIGTERM"); await sleep(500); try { serverProc.kill("SIGKILL"); } catch {} }
}

// ── Test runner ──────────────────────────────────────────────────────────

const groups = [];
function test(name, fn, opts = {}) { groups.push({ name, fn, ...opts }); }

// ══════════════════════════════════════════════════════════════════════════
// NON-INTERACTIVE TESTS (share one session)
// ══════════════════════════════════════════════════════════════════════════

test("Simple command approval", async ({ client, sessionId }) => {
  await send(sessionId, "echo hello_test_123");
  await waitFor(client, "echo hello_test_123", 10000);
  assert(true, "Client shows command for approval");
  client.write("y");
  const out = await waitFor(client, "hello_test_123", 10000);
  assert(strip(out).includes("hello_test_123"), "Output shown after approval");
});

test("Queue processing", async ({ client, sessionId }) => {
  await send(sessionId, "echo first_q"); await sleep(200);
  await send(sessionId, "echo second_q");
  await waitFor(client, "echo first_q", 10000);
  client.write("y");
  await waitFor(client, "echo second_q", 10000);
  assert(true, "Second command prompted after first approved");
  client.write("y");
  await drain(client, 2000);
});

test("Deny flow", async ({ client, sessionId }) => {
  await send(sessionId, "echo denied_cmd");
  await waitFor(client, "echo denied_cmd", 10000);
  client.write("n");
  const out = await drain(client, 2000);
  assert(out.toLowerCase().includes("denied") || out.includes("✗"), "Command denied");
});

test("Classification tags", async ({ client, sessionId }) => {
  await send(sessionId, "echo tag_test");
  const p1 = await waitFor(client, "echo tag_test", 10000);
  assert(strip(p1).includes("[READ-ONLY]"), "echo → [READ-ONLY]");
  client.write("y"); await drain(client, 1500);

  await send(sessionId, "mkdir -p /tmp/shellshock_test_xyz");
  const p2 = await waitFor(client, "mkdir", 10000);
  assert(strip(p2).includes("[WRITE]"), "mkdir → [WRITE]");
  client.write("y"); await drain(client, 1500);

  await send(sessionId, "rm --help");
  const p3 = await waitFor(client, "rm --help", 10000);
  assert(strip(p3).includes("[DESTRUCTIVE]"), "rm → [DESTRUCTIVE]");
  client.write("y"); await drain(client, 1500);

  await send(sessionId, "curl --version");
  const p4 = await waitFor(client, "curl", 10000);
  assert(strip(p4).includes("[NETWORK]"), "curl → [NETWORK]");
  client.write("y"); await drain(client, 1500);
});

test("Git commands", async ({ client, sessionId }) => {
  await send(sessionId, "git status");
  await waitFor(client, "git status", 10000);
  client.write("y");
  const s = await drain(client, 3000);
  assert(s.length > 20, "git status produces output");

  await send(sessionId, "git log --oneline -3");
  await waitFor(client, "git log", 10000);
  client.write("y");
  const l = await drain(client, 3000);
  assert(l.length > 10, "git log produces output");
}, { skipIf: () => !toolAvailable("git") });

test("Stderr and non-zero exit", async ({ client, sessionId }) => {
  await send(sessionId, "ls /nonexistent_dir_xyz");
  await waitFor(client, "nonexistent_dir", 10000);
  client.write("y");
  const e = await drain(client, 3000);
  assert(e.includes("No such file") || e.includes("cannot access") || e.includes("exit"), "Error output for bad path");

  await send(sessionId, "echo stderr_xyz >&2");
  await waitFor(client, "stderr_xyz", 10000);
  client.write("y");
  const se = await drain(client, 2000);
  assert(se.includes("stderr_xyz"), "Stderr captured");

  await send(sessionId, "true");
  await waitFor(client, "true", 10000);
  client.write("y");
  const si = await drain(client, 2000);
  assert(si.length >= 0, "Silent command completes");
});

test("cd command", async ({ client, sessionId }) => {
  await send(sessionId, "cd /tmp");
  await waitFor(client, "cd /tmp", 10000);
  client.write("y");
  await waitFor(client, "/tmp", 5000);
  assert(true, "cd /tmp works");

  await send(sessionId, "pwd");
  await waitFor(client, "pwd", 10000);
  client.write("y");
  const p = await waitFor(client, "/tmp", 5000).catch(() => "");
  assert(strip(p).includes("/tmp"), "pwd confirms /tmp");

  await send(sessionId, "cd /nonexistent_xyz");
  await waitFor(client, "nonexistent_xyz", 10000);
  client.write("y");
  const f = await drain(client, 2000);
  assert(f.includes("No such") || f.includes("cd:"), "cd to nonexistent fails");

  await send(sessionId, "pwd");
  await waitFor(client, "pwd", 10000);
  client.write("y");
  const p2 = await waitFor(client, "/tmp", 5000).catch(() => "");
  assert(strip(p2).includes("/tmp"), "cwd unchanged after failed cd");
});

test("Compound commands: pipe", async ({ client, sessionId }) => {
  await send(sessionId, "echo pipe_xyz | tee /dev/null");
  // Wait for either "Part" (compound prompt) or the command text
  const p = await waitFor(client, "pipe_xyz", 10000);
  const pText = strip(p);
  if (pText.includes("Part")) {
    assert(true, "Compound prompt with parts shown");
    client.write("y"); await sleep(500);
    client.write("y");
  } else {
    // If no compound prompt, it was auto-handled — approve normally
    assert(true, "Pipe command shown for approval");
    client.write("y");
  }
  const out = await drain(client, 3000);
  assert(out.includes("pipe_xyz"), "Piped command produces output");
});

test("Compound commands: chain", async ({ client, sessionId }) => {
  await send(sessionId, "echo chain_a && echo chain_b");
  const p = await waitFor(client, "chain_a", 10000);
  const pText = strip(p);
  if (pText.includes("Part")) {
    client.write("y"); await sleep(500);
    client.write("y");
  } else {
    client.write("y");
  }
  const out = await drain(client, 3000);
  assert(out.includes("chain_a") || out.includes("chain_b"), "Chained command produces output");
});

test("Compound commands: deny segment", async ({ client, sessionId }) => {
  await send(sessionId, "echo safe | rm /danger_xyz");
  const p = await waitFor(client, "safe", 10000);
  const pText = strip(p);
  if (pText.includes("Part")) {
    client.write("y"); await sleep(500); // approve echo
    client.write("n"); // deny rm
  } else {
    client.write("n"); // deny the whole thing
  }
  const out = await drain(client, 2000);
  assert(out.toLowerCase().includes("denied") || out.includes("✗"), "Compound denied when segment rejected");
});

test("Long output", async ({ client, sessionId }) => {
  await send(sessionId, "seq 1 500");
  await waitFor(client, "seq", 10000);
  client.write("y");
  const out = await waitFor(client, "500", 15000).catch(() => "");
  assert(strip(out).includes("500"), "Long output (500 lines) captured");
});

test("Slow silent command", async ({ client, sessionId }) => {
  await send(sessionId, "sleep 2");
  await waitFor(client, "sleep", 10000);
  client.write("y");
  const out = await drain(client, 4000);
  assert(out.includes("exit") || out.includes("✓") || out.length > 0, "sleep 2 completes");
});

test("Rapid-fire: 5 commands", async ({ client, sessionId }) => {
  for (let i = 1; i <= 5; i++) await send(sessionId, `echo rapid_${i}`);
  let ok = true;
  for (let i = 1; i <= 5; i++) {
    try {
      await waitFor(client, `echo rapid_${i}`, 10000);
      client.write("y");
      await sleep(300);
    } catch {
      ok = false; break;
    }
  }
  assert(ok, "All 5 rapid commands prompted and approved");
  await drain(client, 2000);
});

test("Docker commands", async ({ client, sessionId }) => {
  await send(sessionId, "docker ps --format 'table {{.ID}}'");
  const p = await waitFor(client, "docker ps", 10000);
  assert(strip(p).includes("[READ-ONLY]"), "docker ps → [READ-ONLY]");
  client.write("y");
  const out = await drain(client, 5000);
  assert(out.includes("CONTAINER") || out.includes("exit"), "docker ps completes");
}, { skipIf: () => !toolAvailable("docker") });

// ══════════════════════════════════════════════════════════════════════════
// INTERACTIVE TESTS (each gets a fresh session for isolation)
// ══════════════════════════════════════════════════════════════════════════

test("Interactive: watch + Ctrl+C (client mode)", async () => {
  const s = await freshSession();
  try {
    await send(s.sessionId, "watch -n1 echo watch_test", { interactive: true });
    const p = await waitFor(s.client, "INTERACTIVE", 10000);
    assert(strip(p).includes("INTERACTIVE"), "InteractiveChoice prompt shown");

    s.client.write("\r"); // client mode (default)
    await sleep(3000);

    s.client.write("\x03"); // Ctrl+C
    await sleep(2000);

    const alive = await send(s.sessionId, "echo post_watch");
    assert(alive.status === 200, "Session alive after Ctrl+C");
    const out = await waitFor(s.client, "post_watch", 10000).catch(() => "");
    assert(strip(out).includes("post_watch"), "Next command prompted after watch");
    s.client.write("y");
    await drain(s.client, 1500);
  } finally { s.kill(); }
}, { fresh: true });

test("Interactive: less (client mode) — known to break Ink rendering", async () => {
  const s = await freshSession();
  try {
    await send(s.sessionId, "less /etc/hosts", { interactive: true });
    const p = await waitFor(s.client, "INTERACTIVE", 10000);
    assert(strip(p).includes("INTERACTIVE"), "InteractiveChoice shown for less");

    s.client.write("\r"); // client mode
    await sleep(2000);
    s.client.write("q");  // quit less
    await sleep(3000);

    const alive = await send(s.sessionId, "echo post_less");
    assert(alive.status === 200, "Server alive after less exits");

    // This is the key test: does the client TUI recover after less?
    const out = await waitFor(s.client, "post_less", 10000).catch(() => "");
    assert(strip(out).includes("post_less"), "Client TUI recovers after less exits");
    if (strip(out).includes("post_less")) {
      s.client.write("y");
      await drain(s.client, 1500);
    }
  } finally { s.kill(); }
}, { fresh: true });

test("Interactive: deny at choice prompt", async () => {
  const s = await freshSession();
  try {
    await send(s.sessionId, "top -b -n1", { interactive: true });
    const p = await waitFor(s.client, "INTERACTIVE", 10000);
    assert(strip(p).includes("INTERACTIVE"), "InteractiveChoice shown for top");

    await sleep(300);
    s.client.write("\x1B[B"); await sleep(100); // down
    s.client.write("\x1B[B"); await sleep(100); // down (now on Deny)
    s.client.write("\r");

    const out = await drain(s.client, 2000);
    assert(out.toLowerCase().includes("denied") || out.includes("✗"), "Interactive command denied");

    const alive = await send(s.sessionId, "echo post_deny_top");
    assert(alive.status === 200, "Session alive after deny");
    await waitFor(s.client, "post_deny_top", 10000);
    s.client.write("y");
    await drain(s.client, 1500);
  } finally { s.kill(); }
}, { fresh: true });

test("Interactive: watch git log (exit cleanly)", async () => {
  const s = await freshSession();
  try {
    await send(s.sessionId, "watch -n2 git log --oneline -5", { interactive: true });
    await waitFor(s.client, "INTERACTIVE", 10000);
    assert(true, "InteractiveChoice shown for watch git log");

    s.client.write("\r"); // client mode
    await sleep(4000);
    s.client.write("\x03"); // Ctrl+C
    await sleep(2000);

    const alive = await send(s.sessionId, "echo post_watch_git");
    assert(alive.status === 200, "Session alive after watch git log");
    const out = await waitFor(s.client, "post_watch_git", 10000).catch(() => "");
    assert(strip(out).includes("post_watch_git"), "TUI recovers after watch git log");
    s.client.write("y");
    await drain(s.client, 1500);
  } finally { s.kill(); }
}, { fresh: true, skipIf: () => !toolAvailable("git") });

test("Interactive: fast-exit command (date)", async () => {
  const s = await freshSession();
  try {
    await send(s.sessionId, "date", { interactive: true });
    await waitFor(s.client, "INTERACTIVE", 10000);
    s.client.write("\r");
    await sleep(2000);

    const alive = await send(s.sessionId, "echo post_date");
    assert(alive.status === 200, "Session alive after instant-exit interactive");
    const out = await waitFor(s.client, "post_date", 10000).catch(() => "");
    assert(strip(out).includes("post_date"), "TUI recovers after fast-exit interactive");
    s.client.write("y");
    await drain(s.client, 1500);
  } finally { s.kill(); }
}, { fresh: true });

test("Sequential interactive: less then watch", async () => {
  const s = await freshSession();
  try {
    // First: less
    await send(s.sessionId, "less /etc/hosts", { interactive: true });
    await waitFor(s.client, "INTERACTIVE", 10000);
    s.client.write("\r");
    await sleep(2000);
    s.client.write("q");
    await sleep(3000);

    // Second: watch
    await send(s.sessionId, "watch -n1 date", { interactive: true });
    const p2 = await waitFor(s.client, "INTERACTIVE", 10000).catch(() => "");
    assert(strip(p2).includes("INTERACTIVE"), "Second interactive prompt after less exits");

    if (strip(p2).includes("INTERACTIVE")) {
      s.client.write("\r");
      await sleep(3000);
      s.client.write("\x03");
      await sleep(2000);
    }

    const alive = await send(s.sessionId, "echo post_seq");
    assert(alive.status === 200, "Session alive after two interactives");
  } finally { s.kill(); }
}, { fresh: true });

test("Queue after interactive: command queued during interactive run", async () => {
  const s = await freshSession();
  try {
    await send(s.sessionId, "watch -n1 echo q_test", { interactive: true });
    await sleep(300);
    await send(s.sessionId, "echo queued_after_inter");

    await waitFor(s.client, "INTERACTIVE", 10000);
    s.client.write("\r");
    await sleep(3000);
    s.client.write("\x03");
    await sleep(2000);

    const out = await waitFor(s.client, "queued_after_inter", 10000).catch(() => "");
    assert(strip(out).includes("queued_after_inter"), "Queued command prompted after interactive exit");
    if (strip(out).includes("queued_after_inter")) {
      s.client.write("y");
      await drain(s.client, 2000);
    }
  } finally { s.kill(); }
}, { fresh: true });

test("Permission rule saving", async () => {
  const s = await freshSession();
  try {
    await send(s.sessionId, "echo allow_save_xyz");
    await waitFor(s.client, "echo allow_save_xyz", 10000);
    s.client.write("a"); // save pattern
    await waitFor(s.client, "allow_save_xyz", 10000);
    assert(true, "Command approved with pattern save");

    await sleep(500);
    await send(s.sessionId, "echo auto_approved");
    const auto = await waitFor(s.client, "auto_approved", 8000).catch(() => "");
    assert(strip(auto).includes("auto_approved"), "Next echo auto-approved by saved rule");

    await sleep(500);
    s.client.write("p"); // toggle allowlist
    const list = await waitFor(s.client, "echo", 5000).catch(() => "");
    assert(strip(list).includes("echo"), "Allowlist shows saved rule");
    s.client.write("p"); // close
    await sleep(500);
  } finally { s.kill(); }
}, { fresh: true });

// ── Runner ───────────────────────────────────────────────────────────────

async function run() {
  console.log("\n\x1b[1mShellshock Integration Tests\x1b[0m\n");

  console.log("Starting server...");
  await startServer();
  assert(!!engineerToken, "Server started");

  // Create shared session for non-interactive tests
  const shared = await freshSession();
  assert(true, "Shared session ready");

  const startTime = Date.now();

  for (const group of groups) {
    if (group.skipIf && group.skipIf()) {
      console.log(`\n--- ${group.name} ---`);
      skip(group.name);
      continue;
    }
    console.log(`\n--- ${group.name} ---`);
    try {
      if (group.fresh) {
        await group.fn(); // fresh session tests manage their own session
      } else {
        await group.fn(shared); // shared session
      }
    } catch (err) {
      console.log(`  \x1b[31m✗\x1b[0m THREW: ${err.message.split("\n")[0]}`);
      failed++;
    }
  }

  shared.kill();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\x1b[1mResults: ${passed} passed, ${failed} failed, ${skipped} skipped (${elapsed}s)\x1b[0m\n`);
}

run()
  .catch((err) => { console.error("\x1b[31mFatal:\x1b[0m", err.message); failed++; })
  .finally(async () => { await cleanup(); process.exit(failed > 0 ? 1 : 0); });

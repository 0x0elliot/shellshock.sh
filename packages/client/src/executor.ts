import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import * as pty from "node-pty";

let ptyReady = false;
function ensurePtyPermissions() {
  if (ptyReady) return;
  ptyReady = true;
  try {
    const req = createRequire(import.meta.url);
    const pkgPath = req.resolve("node-pty/package.json");
    const helper = join(dirname(pkgPath), "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
    const stat = statSync(helper);
    if (!(stat.mode & 0o111)) {
      chmodSync(helper, stat.mode | 0o755);
    }
  } catch { /* best effort */ }
}

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_RE = /\x1B(?:\[[0-9;?]*[A-Za-z]|\][^\x07\x1B]*(?:\x07|\x1B\\)|\([A-Za-z0-9]|[>=<])|[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F]/g;

function stripEscapes(data: string): string {
  return data.replace(ANSI_ESCAPE_RE, "");
}

export function executeCommand(
  command: string,
  cwd: string | undefined,
  onStdout: (data: string) => void,
  onStderr: (data: string) => void,
  onExit: (code: number | null, signal: string | null) => void
): { kill: () => void } {
  let child: ChildProcess;
  let exited = false;

  try {
    child = spawn(command, [], {
      shell: true,
      cwd: cwd || process.cwd(),
      env: process.env,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onStderr(`Failed to spawn command: ${message}`);
    onExit(-1, null);
    return { kill: () => {} };
  }

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");

  child.stdout?.on("data", (data: string) => {
    onStdout(stripEscapes(data));
  });

  child.stderr?.on("data", (data: string) => {
    onStderr(stripEscapes(data));
  });

  child.on("error", (err: Error) => {
    if (!exited) {
      exited = true;
      onStderr(`Command error: ${err.message}`);
      onExit(-1, null);
    }
  });

  child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
    if (!exited) {
      exited = true;
      onExit(code, signal ? signal : null);
    }
  });

  const kill = () => {
    if (exited) return;

    try {
      child.kill("SIGTERM");
    } catch {
      // Process may already be gone
    }

    // Force kill after 5 seconds if still alive
    const forceKillTimer = setTimeout(() => {
      if (!exited) {
        try {
          child.kill("SIGKILL");
        } catch {
          // Ignore
        }
      }
    }, 5000);

    // Don't let the timer keep the process alive
    if (typeof forceKillTimer === "object" && forceKillTimer && "unref" in forceKillTimer) {
      (forceKillTimer as NodeJS.Timeout).unref();
    }
  };

  return { kill };
}

export interface PTYHandle {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
}

export function executePTY(
  command: string,
  cwd: string | undefined,
  onData: (data: string) => void,
  onExit: (code: number | null, signal: string | null) => void,
): PTYHandle {
  ensurePtyPermissions();
  const shell = process.env.SHELL || "/bin/bash";
  const cols = Math.max(process.stdout.columns || 80, 1);
  const rows = Math.max(process.stdout.rows || 24, 1);

  const cleanEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) cleanEnv[k] = v;
  }

  const ptyProcess = pty.spawn(shell, ["-c", command], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: cwd || process.cwd(),
    env: cleanEnv,
  });

  ptyProcess.onData(onData);
  ptyProcess.onExit(({ exitCode, signal }) => {
    onExit(exitCode, signal ? String(signal) : null);
  });

  return {
    write: (data: string) => ptyProcess.write(data),
    resize: (cols: number, rows: number) => ptyProcess.resize(cols, rows),
    kill: () => {
      try { ptyProcess.kill(); } catch { /* already dead */ }
    },
  };
}

export function executeInteractive(
  command: string,
  cwd: string | undefined,
): Promise<{ code: number | null; signal: string | null }> {
  return new Promise((resolve) => {
    // Don't change raw mode — the child process (vim, htop, etc.) sets its
    // own terminal mode via termios. Forcing canonical mode here fights with
    // programs that expect raw mode from the start.
    process.stdin.pause();

    const child = spawn(command, [], {
      shell: true,
      cwd: cwd || process.cwd(),
      stdio: "inherit",
    });

    child.on("exit", (code, signal) => {
      process.stdin.resume();
      resolve({ code, signal: signal ?? null });
    });

    child.on("error", () => {
      process.stdin.resume();
      resolve({ code: -1, signal: null });
    });
  });
}

import Database, { type Database as DatabaseType } from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";

const DATA_DIR = join(homedir(), ".remote-debugger");
mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = join(DATA_DIR, "sessions.db");

const db: DatabaseType = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    label TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT,
    client_hostname TEXT,
    client_platform TEXT,
    client_username TEXT
  );

  CREATE TABLE IF NOT EXISTS commands (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    command TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    exit_code INTEGER,
    signal TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT,
    output TEXT DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_commands_session ON commands(session_id);
`);

export interface SessionRow {
  id: string;
  token: string;
  label: string | null;
  created_at: string;
  closed_at: string | null;
  client_hostname: string | null;
  client_platform: string | null;
  client_username: string | null;
}

export interface CommandRow {
  id: string;
  session_id: string;
  command: string;
  status: string;
  exit_code: number | null;
  signal: string | null;
  created_at: string;
  resolved_at: string | null;
  output: string;
}

const stmts = {
  createSession: db.prepare(
    "INSERT INTO sessions (id, token, label) VALUES (?, ?, ?)"
  ),
  getSession: db.prepare("SELECT * FROM sessions WHERE id = ?"),
  getSessionByToken: db.prepare("SELECT * FROM sessions WHERE token = ?"),
  closeSession: db.prepare(
    "UPDATE sessions SET closed_at = datetime('now') WHERE id = ?"
  ),
  setClientInfo: db.prepare(
    "UPDATE sessions SET client_hostname = ?, client_platform = ?, client_username = ? WHERE id = ?"
  ),
  listActiveSessions: db.prepare(
    "SELECT * FROM sessions WHERE closed_at IS NULL ORDER BY created_at DESC"
  ),
  createCommand: db.prepare(
    "INSERT INTO commands (id, session_id, command) VALUES (?, ?, ?)"
  ),
  updateCommandStatus: db.prepare(
    "UPDATE commands SET status = ?, resolved_at = datetime('now') WHERE id = ?"
  ),
  updateCommandExit: db.prepare(
    "UPDATE commands SET status = 'completed', exit_code = ?, signal = ?, resolved_at = datetime('now') WHERE id = ?"
  ),
  appendCommandOutput: db.prepare(
    "UPDATE commands SET output = output || ? WHERE id = ?"
  ),
  getCommand: db.prepare("SELECT * FROM commands WHERE id = ?"),
  getSessionCommands: db.prepare(
    "SELECT * FROM commands WHERE session_id = ? ORDER BY created_at ASC"
  ),
};

export const dbOps = {
  createSession(id: string, token: string, label?: string) {
    stmts.createSession.run(id, token, label ?? null);
  },
  getSession(id: string): SessionRow | undefined {
    return stmts.getSession.get(id) as SessionRow | undefined;
  },
  getSessionByToken(token: string): SessionRow | undefined {
    return stmts.getSessionByToken.get(token) as SessionRow | undefined;
  },
  closeSession(id: string) {
    stmts.closeSession.run(id);
  },
  setClientInfo(id: string, hostname: string, platform: string, username: string) {
    stmts.setClientInfo.run(hostname, platform, username, id);
  },
  listActiveSessions(): SessionRow[] {
    return stmts.listActiveSessions.all() as SessionRow[];
  },
  createCommand(id: string, sessionId: string, command: string) {
    stmts.createCommand.run(id, sessionId, command);
  },
  updateCommandStatus(id: string, status: string) {
    stmts.updateCommandStatus.run(status, id);
  },
  updateCommandExit(id: string, exitCode: number | null, signal: string | null) {
    stmts.updateCommandExit.run(exitCode, signal, id);
  },
  appendCommandOutput(id: string, data: string) {
    stmts.appendCommandOutput.run(data, id);
  },
  getCommand(id: string): CommandRow | undefined {
    return stmts.getCommand.get(id) as CommandRow | undefined;
  },
  getSessionCommands(sessionId: string): CommandRow[] {
    return stmts.getSessionCommands.all(sessionId) as CommandRow[];
  },
};

export { db };

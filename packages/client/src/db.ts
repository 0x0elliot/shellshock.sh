import Database, { type Database as DatabaseType } from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";

const DATA_DIR = join(homedir(), ".remote-debugger");
mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = join(DATA_DIR, "client.db");

const db: DatabaseType = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS permission_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('allow', 'deny')),
    rule TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(session_id, type, rule)
  );

  CREATE INDEX IF NOT EXISTS idx_rules_session ON permission_rules(session_id);
`);

const stmts = {
  addRule: db.prepare(
    "INSERT OR IGNORE INTO permission_rules (session_id, type, rule) VALUES (?, ?, ?)"
  ),
  removeRule: db.prepare(
    "DELETE FROM permission_rules WHERE session_id = ? AND rule = ?"
  ),
  getRules: db.prepare(
    "SELECT type, rule FROM permission_rules WHERE session_id = ? ORDER BY created_at ASC"
  ),
};

export const clientDb = {
  addRule(sessionId: string, type: "allow" | "deny", rule: string): void {
    stmts.addRule.run(sessionId, type, rule);
  },
  removeRule(sessionId: string, rule: string): void {
    stmts.removeRule.run(sessionId, rule);
  },
  getRules(sessionId: string): { type: "allow" | "deny"; rule: string }[] {
    return stmts.getRules.all(sessionId) as { type: "allow" | "deny"; rule: string }[];
  },
};

export { db };

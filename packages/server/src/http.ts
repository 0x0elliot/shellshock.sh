import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { dbOps } from "./db.js";
import type { SessionManager } from "./session-manager.js";
import type { ClientToServerMessage } from "shellshock.sh-shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createServer(sessionManager: SessionManager) {
  const app = express();

  app.use(express.json());

  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS"
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );
    if (_req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  function extractToken(req: express.Request): string | null {
    const queryToken = req.query.token;
    if (typeof queryToken === "string" && queryToken) return queryToken;

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      return authHeader.slice(7);
    }

    return null;
  }

  function clientAuth(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ): void {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: "Token required" });
      return;
    }

    const sessionId = req.params.id as string;
    const row = dbOps.getSessionByToken(token);
    if (!row || row.id !== sessionId) {
      res.status(403).json({ error: "Invalid token" });
      return;
    }

    next();
  }

  // POST /api/sessions — create session
  app.post("/api/sessions", (req, res) => {
    const { label } = req.body ?? {};
    const { sessionId, token } = sessionManager.createSession(label);

    const host = req.headers.host ?? `localhost:3000`;
    const protocol = req.protocol;
    const connectUrl = `${protocol}://${host}/session/${sessionId}?token=${token}`;

    res.json({ sessionId, token, connectUrl });
  });

  // GET /api/sessions — list
  app.get("/api/sessions", (_req, res) => {
    const sessions = sessionManager.getActiveSessions().map((s) => ({
      id: s.id,
      label: s.label,
      clientConnected: s.clientSSE !== null,
      engineerConnected: s.engineerSSE !== null,
      handshakeComplete: s.handshakeComplete,
      clientInfo: s.clientInfo
        ? {
            hostname: s.clientInfo.hostname,
            platform: s.clientInfo.platform,
            username: s.clientInfo.username,
          }
        : null,
      createdAt: s.createdAt.toISOString(),
    }));
    res.json({ sessions });
  });

  // GET /api/sessions/:id/events — client SSE (requires token)
  app.get("/api/sessions/:id/events", (req, res) => {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: "Token required" });
      return;
    }

    const sessionId = req.params.id as string;
    const connected = sessionManager.connectClient(sessionId, token, res);
    if (!connected) {
      // connectClient already sent 409 if duplicate, or this is invalid session/token
      if (!res.headersSent) {
        res.status(403).json({ error: "Invalid session or token" });
      }
      return;
    }
  });

  // POST /api/sessions/:id/respond — client response (requires token)
  app.post("/api/sessions/:id/respond", clientAuth, (req, res) => {
    const sessionId = req.params.id as string;
    const msg = req.body as ClientToServerMessage;

    if (!msg || !msg.type) {
      res.status(400).json({ error: "Invalid message" });
      return;
    }

    sessionManager.handleClientResponse(sessionId, msg);
    res.json({ ok: true });
  });

  // GET /api/sessions/:id/engineer-events — engineer SSE
  app.get("/api/sessions/:id/engineer-events", (req, res) => {
    const sessionId = req.params.id as string;
    const connected = sessionManager.connectEngineer(sessionId, res);
    if (!connected) {
      if (!res.headersSent) {
        res.status(404).json({ error: "Session not found or engineer already connected" });
      }
      return;
    }
  });

  // POST /api/sessions/:id/commands — engineer sends command (gated on handshake)
  app.post("/api/sessions/:id/commands", (req, res) => {
    const sessionId = req.params.id as string;
    const { command, cwd } = req.body ?? {};

    if (!command || typeof command !== "string") {
      res.status(400).json({ error: "command is required" });
      return;
    }

    if (!sessionManager.isHandshakeComplete(sessionId)) {
      res.status(403).json({ error: "Handshake not complete — wait for client to connect and verify" });
      return;
    }

    const commandId = sessionManager.requestCommand(sessionId, command, cwd);
    if (!commandId) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    res.json({ commandId });
  });

  // GET /session/:id — serve web terminal
  app.get("/session/:id", (_req, res) => {
    const publicDir = join(__dirname, "public");
    res.sendFile(join(publicDir, "index.html"));
  });

  return app;
}

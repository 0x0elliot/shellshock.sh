import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import { nanoid } from "nanoid";
import type { Response } from "express";
import {
  encryptMessage,
  decryptMessage,
  classifyCommand,
  CommandClassification,
} from "shellshock.sh-shared";
import type {
  ClientInfo,
  ClientToServerMessage,
  CommandRequest,
  EncryptedEnvelope,
  ServerToClientMessage,
  ServerToEngineerMessage,
} from "shellshock.sh-shared";

const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export interface ActiveSession {
  id: string;
  token: string;
  label: string | null;
  clientSSE: Response | null;
  engineerSSE: Response | null;
  clientInfo: ClientInfo | null;
  pendingCommands: Map<string, CommandRequest>;
  heartbeatInterval: NodeJS.Timeout | null;
  createdAt: Date;
  lastActivity: number;
  // Handshake state
  handshakeComplete: boolean;
  privateKey: string | null;
  nonce: string | null;
  sessionKey: Buffer | null;
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

function createEmptySession(
  id: string,
  token: string,
  label: string | null,
  createdAt: Date
): ActiveSession {
  return {
    id,
    token,
    label,
    clientSSE: null,
    engineerSSE: null,
    clientInfo: null,
    pendingCommands: new Map(),
    heartbeatInterval: null,
    createdAt,
    lastActivity: Date.now(),
    handshakeComplete: false,
    privateKey: null,
    nonce: null,
    sessionKey: null,
  };
}

export class SessionManager extends EventEmitter {
  private sessions = new Map<string, ActiveSession>();
  private reaperInterval: NodeJS.Timeout;

  constructor() {
    super();
    this.reaperInterval = setInterval(() => this.reapExpiredSessions(), 30_000);
  }

  private touchSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) session.lastActivity = Date.now();
  }

  private reapExpiredSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
        this.closeSession(id);
        this.emit("sessionExpired", id);
      }
    }
  }

  createSession(label?: string): { sessionId: string; token: string } {
    const sessionId = nanoid(12);
    const token = nanoid(32);

    const session = createEmptySession(sessionId, token, label ?? null, new Date());
    this.sessions.set(sessionId, session);
    return { sessionId, token };
  }

  // --- Handshake init (server side) ---

  initHandshake(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.clientSSE) return false;

    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const nonce = crypto.randomBytes(32).toString("hex");

    session.privateKey = privateKey;
    session.nonce = nonce;
    session.handshakeComplete = false;

    this.sendToClient(sessionId, {
      type: "handshake_challenge",
      publicKey,
      nonce,
    });

    this.emit("handshakeStarted", sessionId);
    return true;
  }

  private verifyHandshake(sessionId: string, encryptedNonce: string, encryptedSessionKey: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.privateKey || !session.nonce) return false;

    try {
      const decrypted = crypto.privateDecrypt(
        { key: session.privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
        Buffer.from(encryptedNonce, "base64")
      ).toString("utf8");

      if (decrypted !== session.nonce) return false;

      const sessionKey = crypto.privateDecrypt(
        { key: session.privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
        Buffer.from(encryptedSessionKey, "base64")
      );
      if (sessionKey.length !== 32) return false;

      session.handshakeComplete = true;
      session.privateKey = null;
      session.nonce = null;

      // Send handshake_complete BEFORE storing the session key —
      // the client needs this unencrypted to learn the handshake succeeded
      // and activate its own copy of the key.
      this.sendToClient(sessionId, {
        type: "handshake_complete",
        sessionId,
      });

      session.sessionKey = sessionKey;

      this.sendToEngineer(sessionId, {
        type: "handshake_complete",
        sessionId,
      });

      this.emit("handshakeComplete", sessionId);
      return true;
    } catch {
      return false;
    }
  }

  isHandshakeComplete(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return session?.handshakeComplete ?? false;
  }

  // --- Connections (1 client + 1 engineer per session) ---

  connectClient(sessionId: string, token: string, res: Response): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (session.token !== token) return false;

    if (session.clientSSE) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "A client is already connected to this session" }));
      return false;
    }

    res.writeHead(200, SSE_HEADERS);
    res.flushHeaders();

    session.clientSSE = res;
    this.touchSession(sessionId);

    this.startHeartbeat(session);

    res.on("close", () => {
      if (session.clientSSE === res) {
        this.disconnectClient(sessionId, "connection closed");
      }
    });

    this.initHandshake(sessionId);

    return true;
  }

  connectEngineer(sessionId: string, res: Response): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (session.engineerSSE) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "An engineer is already connected to this session" }));
      return false;
    }

    res.writeHead(200, SSE_HEADERS);
    res.flushHeaders();

    session.engineerSSE = res;
    this.touchSession(sessionId);

    if (session.clientInfo) {
      this.writeSSE(res, {
        type: "client_connected",
        sessionId,
        clientInfo: session.clientInfo,
      } satisfies ServerToEngineerMessage);
    }

    if (session.handshakeComplete) {
      this.writeSSE(res, {
        type: "handshake_complete",
        sessionId,
      } satisfies ServerToEngineerMessage);
    }

    res.on("close", () => {
      if (session.engineerSSE === res) {
        session.engineerSSE = null;
        this.emit("engineerDisconnected", sessionId);
      }
    });

    return true;
  }

  // --- Messaging ---

  sendToClient(sessionId: string, msg: ServerToClientMessage): boolean {
    const session = this.sessions.get(sessionId);
    if (!session?.clientSSE) return false;
    if (session.sessionKey) {
      const envelope: EncryptedEnvelope = {
        _enc: encryptMessage(session.sessionKey, JSON.stringify(msg)),
      };
      return this.writeSSE(session.clientSSE, envelope);
    }
    return this.writeSSE(session.clientSSE, msg);
  }

  sendToEngineer(sessionId: string, msg: ServerToEngineerMessage): boolean {
    const session = this.sessions.get(sessionId);
    if (!session?.engineerSSE) return false;
    return this.writeSSE(session.engineerSSE, msg);
  }

  // --- Commands (gated on handshake) ---

  requestCommand(
    sessionId: string,
    command: string,
    cwd?: string,
    interactive?: boolean,
  ): string | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (!session.handshakeComplete) return null;

    this.touchSession(sessionId);

    const commandId = nanoid(12);

    const autoInteractive = !interactive &&
      classifyCommand(command) === CommandClassification.Interactive;

    const request: CommandRequest = {
      type: "command_request",
      id: commandId,
      command,
      cwd,
      ...((interactive || autoInteractive) ? { interactive: true } : {}),
    };

    session.pendingCommands.set(commandId, request);

    this.sendToClient(sessionId, request);
    this.sendToEngineer(sessionId, request);

    return commandId;
  }

  cancelCommand(sessionId: string, commandId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (!session.pendingCommands.has(commandId)) return false;

    session.pendingCommands.delete(commandId);

    this.sendToClient(sessionId, { type: "command_cancel", id: commandId });
    this.sendToEngineer(sessionId, { type: "command_cancel", id: commandId });

    this.emit("commandCancelled", sessionId, commandId);
    return true;
  }

  sendInteractiveInput(sessionId: string, commandId: string, data: string): void {
    this.sendToClient(sessionId, {
      type: "interactive_input",
      id: commandId,
      data,
    });
  }

  sendInteractiveResize(sessionId: string, commandId: string, cols: number, rows: number): void {
    this.sendToClient(sessionId, {
      type: "interactive_resize",
      id: commandId,
      cols,
      rows,
    });
  }

  killRunningCommand(sessionId: string, commandId: string): void {
    this.sendToClient(sessionId, { type: "command_cancel", id: commandId });
    this.emit("commandCancelled", sessionId, commandId);
  }

  getLastPendingCommandId(sessionId: string): string | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    let lastId: string | null = null;
    for (const id of session.pendingCommands.keys()) {
      lastId = id;
    }
    return lastId;
  }

  handleClientResponse(
    sessionId: string,
    rawMsg: ClientToServerMessage | EncryptedEnvelope
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.touchSession(sessionId);

    let msg: ClientToServerMessage;
    if ("_enc" in rawMsg && session.sessionKey) {
      try {
        msg = JSON.parse(decryptMessage(session.sessionKey, rawMsg._enc));
      } catch (e) {
        this.emit("debug", `decrypt failed for session ${sessionId}: ${e}`);
        return;
      }
    } else if ("_enc" in rawMsg) {
      this.emit("debug", `encrypted msg but no session key for ${sessionId}`);
      return;
    } else {
      msg = rawMsg;
    }

    this.emit("debug", `handleClientResponse: ${msg.type} ${"id" in msg ? msg.id : ""}`);

    switch (msg.type) {
      case "handshake_response": {
        const ok = this.verifyHandshake(sessionId, msg.encryptedNonce, msg.encryptedSessionKey);
        if (!ok) {
          const err = { type: "handshake_error" as const, message: "Handshake verification failed" };
          this.sendToClient(sessionId, err);
          this.sendToEngineer(sessionId, err);
          this.disconnectClient(sessionId, "handshake failed");
        }
        break;
      }

      case "client_info": {
        session.clientInfo = msg;

        this.sendToEngineer(sessionId, {
          type: "client_connected",
          sessionId,
          clientInfo: msg,
        });
        this.emit("clientConnected", sessionId, msg);
        break;
      }

      case "command_approved": {
        session.pendingCommands.delete(msg.id);

        this.sendToEngineer(sessionId, msg);
        this.emit("commandApproved", sessionId, msg.id);
        break;
      }

      case "command_denied": {
        session.pendingCommands.delete(msg.id);

        this.sendToEngineer(sessionId, msg);
        this.emit("commandDenied", sessionId, msg.id, msg.reason);
        break;
      }

      case "command_output": {
        this.sendToEngineer(sessionId, msg);
        this.emit("commandOutput", sessionId, msg.id, msg.stream, msg.data);
        break;
      }

      case "command_exit": {
        this.sendToEngineer(sessionId, msg);
        this.emit(
          "commandExit",
          sessionId,
          msg.id,
          msg.exitCode,
          msg.signal
        );
        break;
      }

      case "interactive_mode": {
        this.sendToEngineer(sessionId, {
          type: "interactive_started",
          id: msg.id,
          mode: msg.mode,
        });
        this.emit("interactiveStarted", sessionId, msg.id, msg.mode);
        break;
      }

      case "interactive_output": {
        this.emit("interactiveOutput", sessionId, msg.id, msg.data);
        break;
      }
    }
  }

  // --- Disconnect / cleanup ---

  disconnectClient(sessionId: string, reason: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.heartbeatInterval) {
      clearInterval(session.heartbeatInterval);
      session.heartbeatInterval = null;
    }

    if (session.clientSSE) {
      try {
        session.clientSSE.end();
      } catch {
        // ignore
      }
      session.clientSSE = null;
    }

    session.handshakeComplete = false;
    session.privateKey = null;
    session.nonce = null;
    session.sessionKey = null;

    this.sendToEngineer(sessionId, {
      type: "client_disconnected",
      sessionId,
      reason,
    });
    this.emit("clientDisconnected", sessionId, reason);
  }

  getActiveSessions(): ActiveSession[] {
    return Array.from(this.sessions.values());
  }

  getSession(sessionId: string): ActiveSession | undefined {
    return this.sessions.get(sessionId);
  }

  validateToken(sessionId: string, token: string): boolean {
    const session = this.sessions.get(sessionId);
    return session?.token === token;
  }

  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.disconnectClient(sessionId, "session closed");

    if (session.engineerSSE) {
      try {
        session.engineerSSE.end();
      } catch {
        // ignore
      }
      session.engineerSSE = null;
    }

    session.sessionKey = null;
    this.sessions.delete(sessionId);
  }

  private startHeartbeat(session: ActiveSession): void {
    if (session.heartbeatInterval) {
      clearInterval(session.heartbeatInterval);
    }

    session.heartbeatInterval = setInterval(() => {
      if (session.clientSSE) {
        this.writeSSE(session.clientSSE, { type: "heartbeat", timestamp: Date.now() });
      }
      if (session.engineerSSE) {
        this.writeSSE(session.engineerSSE, { type: "heartbeat", timestamp: Date.now() });
      }
    }, 15_000);
  }

  private writeSSE(res: Response, data: unknown): boolean {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const ok = res.write(payload);
        if (ok) return true;
        return true;
      } catch {
        if (attempt === maxRetries) return false;
      }
    }
    return false;
  }
}

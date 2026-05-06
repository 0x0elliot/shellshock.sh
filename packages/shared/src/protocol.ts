export interface CommandRequest {
  type: "command_request";
  id: string;
  command: string;
  cwd?: string;
}

export interface CommandApproved {
  type: "command_approved";
  id: string;
}

export interface CommandDenied {
  type: "command_denied";
  id: string;
  reason?: string;
}

export interface CommandOutput {
  type: "command_output";
  id: string;
  stream: "stdout" | "stderr";
  data: string;
}

export interface CommandExit {
  type: "command_exit";
  id: string;
  exitCode: number | null;
  signal: string | null;
}

export interface CommandCancel {
  type: "command_cancel";
  id: string;
}

export interface ClientInfo {
  type: "client_info";
  hostname: string;
  platform: string;
  username: string;
}

export interface SessionCreated {
  type: "session_created";
  sessionId: string;
  connectUrl: string;
}

export interface ClientConnected {
  type: "client_connected";
  sessionId: string;
  clientInfo: ClientInfo;
}

export interface ClientDisconnected {
  type: "client_disconnected";
  sessionId: string;
  reason: string;
}

export interface Heartbeat {
  type: "heartbeat";
  timestamp: number;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

// --- Handshake ---

export interface HandshakeChallenge {
  type: "handshake_challenge";
  publicKey: string;
  nonce: string;
}

export interface HandshakeResponse {
  type: "handshake_response";
  encryptedNonce: string;
}

export interface HandshakeComplete {
  type: "handshake_complete";
  sessionId: string;
}

export interface HandshakeError {
  type: "handshake_error";
  message: string;
}

export type ServerToClientMessage =
  | CommandRequest
  | CommandCancel
  | HandshakeChallenge
  | HandshakeComplete
  | HandshakeError
  | Heartbeat
  | ErrorMessage;

export type ClientToServerMessage =
  | CommandApproved
  | CommandDenied
  | CommandOutput
  | CommandExit
  | ClientInfo
  | HandshakeResponse;

export type ServerToEngineerMessage =
  | CommandRequest
  | CommandApproved
  | CommandDenied
  | CommandOutput
  | CommandExit
  | CommandCancel
  | ClientConnected
  | ClientDisconnected
  | HandshakeComplete
  | HandshakeError
  | SessionCreated
  | Heartbeat
  | ErrorMessage;

export type EngineerToServerMessage =
  | CommandRequest;

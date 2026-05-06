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

export interface InteractiveMode {
  type: "interactive_mode";
  id: string;
  mode: "client" | "engineer";
}

export interface InteractiveInput {
  type: "interactive_input";
  id: string;
  data: string;
}

export interface InteractiveStarted {
  type: "interactive_started";
  id: string;
  mode: "client" | "engineer";
}

export interface InteractiveOutput {
  type: "interactive_output";
  id: string;
  data: string;
}

export interface InteractiveResize {
  type: "interactive_resize";
  id: string;
  cols: number;
  rows: number;
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
  | InteractiveInput
  | InteractiveResize
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
  | HandshakeResponse
  | InteractiveMode
  | InteractiveOutput;

export type ServerToEngineerMessage =
  | CommandRequest
  | CommandApproved
  | CommandDenied
  | CommandOutput
  | CommandExit
  | CommandCancel
  | InteractiveStarted
  | ClientConnected
  | ClientDisconnected
  | HandshakeComplete
  | HandshakeError
  | SessionCreated
  | Heartbeat
  | ErrorMessage;

export type EngineerToServerMessage =
  | CommandRequest;

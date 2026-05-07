import React, { useState, useEffect, useCallback, useRef } from "react";
import { execSync } from "node:child_process";
import { Box, Text, useInput, useApp } from "ink";
import type { SessionManager } from "./session-manager.js";
import { StatusBar } from "./components/status-bar.js";
import {
  OutputStream,
  type CommandEntry,
} from "./components/output-stream.js";
import { CommandInput } from "./components/command-input.js";
import { SecretSharePanel } from "./components/secret-share.js";
import type { SecretStore } from "./secret-store.js";
import { useOutputBuffer } from "./hooks/use-output-buffer.js";
import {
  classifyCommand,
  CommandClassification,
  type ClientInfo,
} from "shellshock.sh-shared";

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B(?:\[[0-9;?]*[A-Za-z]|\][^\x07\x1B]*(?:\x07|\x1B\\)|\([A-Za-z0-9]|[>=<])|[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F]/g;

interface AppProps {
  sessionManager: SessionManager;
  secretStore: SecretStore;
  host: string;
  port: number;
  tunnelUrl?: string;
}

export function App({ sessionManager, secretStore, host, port, tunnelUrl }: AppProps) {
  const { exit } = useApp();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [clientConnected, setClientConnected] = useState(false);
  const [handshakeComplete, setHandshakeComplete] = useState(false);
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null);
  const [commands, setCommands] = useState<CommandEntry[]>([]);
  const [notification, setNotification] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [interactiveSession, setInteractiveSession] = useState<{
    commandId: string;
    mode: "client" | "engineer";
  } | null>(null);
  const [showSecretPanel, setShowSecretPanel] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const pushOutput = useOutputBuffer(
    useCallback((merged: Map<string, string>) => {
      setCommands((prev) => {
        let next = prev;
        for (const [cmdId, data] of merged) {
          next = next.map((cmd) =>
            cmd.id === cmdId
              ? {
                  ...cmd,
                  output: (cmd.output ?? "") + data,
                  status: cmd.status === "pending" || cmd.status === "approved"
                    ? "running" as const
                    : cmd.status,
                }
              : cmd,
          );
        }
        return next;
      });
    }, []),
  );

  const copyToClipboard = useCallback((text: string) => {
    const cmds: Record<string, string[]> = {
      darwin:  ["pbcopy"],
      win32:   ["clip"],
      linux:   ["xclip -selection clipboard", "xsel --clipboard --input", "wl-copy"],
    };
    const candidates = cmds[process.platform] ?? cmds.linux;

    for (const cmd of candidates) {
      try {
        execSync(cmd, { input: text, stdio: ["pipe", "ignore", "ignore"] });
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return;
      } catch {
        // Try next
      }
    }
  }, []);

  const createSession = useCallback(() => {
    if (sessionIdRef.current) {
      sessionManager.closeSession(sessionIdRef.current);
    }

    const { sessionId: sid, token } = sessionManager.createSession();
    const base = tunnelUrl ?? `http://${host}:${port}`;
    const url = `${base}/session/${sid}?token=${token}`;
    const clientCmd = `curl -sL shellshock.sh/get | bash -s -- "${url}"`;

    setSessionId(sid);
    setSessionToken(token);
    setClientConnected(false);
    setHandshakeComplete(false);
    setClientInfo(null);
    setCommands([]);
    setInteractiveSession(null);

    copyToClipboard(clientCmd);
    setNotification(url);
  }, [sessionManager, tunnelUrl, host, port, copyToClipboard]);

  // Auto-create session on mount
  useEffect(() => {
    createSession();
  }, [createSession]);

  // Session manager events
  useEffect(() => {
    function onClientConnected(sid: string, info: ClientInfo) {
      if (sid !== sessionIdRef.current) return;
      setClientConnected(true);
      setClientInfo(info);
      setNotification(null);
    }

    function onClientDisconnected(sid: string) {
      if (sid !== sessionIdRef.current) return;
      setClientConnected(false);
      setInteractiveSession(null);
    }

    function onHandshakeComplete(sid: string) {
      if (sid !== sessionIdRef.current) return;
      setHandshakeComplete(true);
    }

    const isTerminal = (s: string) => s === "completed" || s === "failed" || s === "denied";

    function onCommandApproved(_sid: string, commandId: string) {
      setCommands((prev) =>
        prev.map((cmd) =>
          cmd.id === commandId && !isTerminal(cmd.status)
            ? { ...cmd, status: "running" as const }
            : cmd,
        ),
      );
    }

    function onCommandDenied(_sid: string, commandId: string, reason?: string) {
      setCommands((prev) =>
        prev.map((cmd) =>
          cmd.id === commandId && !isTerminal(cmd.status)
            ? { ...cmd, status: "denied" as const, deniedReason: reason }
            : cmd,
        ),
      );
    }

    function onCommandOutput(_sid: string, commandId: string, _stream: string, data: string) {
      pushOutput(commandId, data.replace(ANSI_RE, ""));
    }

    function onCommandExit(_sid: string, commandId: string, exitCode: number | null) {
      setCommands((prev) =>
        prev.map((cmd) =>
          cmd.id === commandId
            ? {
                ...cmd,
                status: exitCode === 0 ? ("completed" as const) : ("failed" as const),
                exitCode,
              }
            : cmd,
        ),
      );
      setInteractiveSession((prev) =>
        prev && prev.commandId === commandId ? null : prev,
      );
    }

    function onCommandCancelled(_sid: string, commandId: string) {
      setCommands((prev) =>
        prev.map((cmd) =>
          cmd.id === commandId
            ? { ...cmd, status: "denied" as const, deniedReason: "Cancelled" }
            : cmd,
        ),
      );
    }

    function onInteractiveStarted(sid: string, commandId: string, mode: "client" | "engineer") {
      if (sid !== sessionIdRef.current) return;
      setInteractiveSession({ commandId, mode });
    }

    sessionManager.on("clientConnected", onClientConnected);
    sessionManager.on("clientDisconnected", onClientDisconnected);
    sessionManager.on("handshakeComplete", onHandshakeComplete);
    sessionManager.on("commandApproved", onCommandApproved);
    sessionManager.on("commandDenied", onCommandDenied);
    sessionManager.on("commandOutput", onCommandOutput);
    sessionManager.on("commandExit", onCommandExit);
    sessionManager.on("commandCancelled", onCommandCancelled);
    sessionManager.on("interactiveStarted", onInteractiveStarted);

    return () => {
      sessionManager.off("clientConnected", onClientConnected);
      sessionManager.off("clientDisconnected", onClientDisconnected);
      sessionManager.off("handshakeComplete", onHandshakeComplete);
      sessionManager.off("commandApproved", onCommandApproved);
      sessionManager.off("commandDenied", onCommandDenied);
      sessionManager.off("commandOutput", onCommandOutput);
      sessionManager.off("commandExit", onCommandExit);
      sessionManager.off("commandCancelled", onCommandCancelled);
      sessionManager.off("interactiveStarted", onInteractiveStarted);
    };
  }, [sessionManager, pushOutput]);

  const engineerInteractive = interactiveSession?.mode === "engineer";

  const canSendCommands = handshakeComplete;
  const inputIsActive = canSendCommands && !notification;

  let connectUrl: string | null = null;
  if (sessionId && !clientConnected) {
    const base = tunnelUrl ?? `http://${host}:${port}`;
    connectUrl = `${base}/session/${sessionId}?token=${sessionToken}`;
  }

  // Engineer-interactive terminal takeover
  useEffect(() => {
    if (!engineerInteractive || !interactiveSession || !sessionId) return;

    const { commandId: cid } = interactiveSession;
    const sid = sessionId;

    const savedDataListeners = process.stdin.rawListeners("data").slice();
    const savedKeypressListeners = process.stdin.rawListeners("keypress").slice();
    const savedReadableListeners = process.stdin.rawListeners("readable").slice();
    process.stdin.removeAllListeners("data");
    process.stdin.removeAllListeners("keypress");
    process.stdin.removeAllListeners("readable");

    const rawStdoutWrite = process.stdout.write.bind(process.stdout) as typeof process.stdout.write;
    (process.stdout as any).write = (() => true) as any;

    rawStdoutWrite("\x1b[?1003l\x1b[?1006l\x1b[?1002l\x1b[?1000l");
    rawStdoutWrite("\x1B[?1049l");
    rawStdoutWrite("\x1B[2J\x1B[H");

    const stdinHandler = (chunk: Buffer) => {
      const str = chunk.toString();
      if (str === "\x1d") {
        sessionManager.killRunningCommand(sid, cid);
        setInteractiveSession(null);
        return;
      }
      sessionManager.sendInteractiveInput(sid, cid, str);
    };
    process.stdin.on("data", stdinHandler);

    const outputHandler = (_sid: string, _cmdId: string, data: string) => {
      rawStdoutWrite(data);
    };
    sessionManager.on("interactiveOutput", outputHandler);

    sessionManager.sendInteractiveResize(
      sid, cid, process.stdout.columns, process.stdout.rows,
    );

    const resizeHandler = () => {
      sessionManager.sendInteractiveResize(
        sid, cid, process.stdout.columns, process.stdout.rows,
      );
    };
    process.stdout.on("resize", resizeHandler);

    return () => {
      process.stdin.off("data", stdinHandler);
      sessionManager.off("interactiveOutput", outputHandler);
      process.stdout.off("resize", resizeHandler);

      (process.stdout as any).write = rawStdoutWrite;
      process.stdout.write("\x1B[?1049h");

      process.stdin.removeAllListeners("data");
      process.stdin.removeAllListeners("keypress");
      process.stdin.removeAllListeners("readable");
      for (const l of savedReadableListeners) process.stdin.on("readable", l as (...args: unknown[]) => void);
      for (const l of savedDataListeners) process.stdin.on("data", l as (...args: unknown[]) => void);
      for (const l of savedKeypressListeners) process.stdin.on("keypress", l as (...args: unknown[]) => void);
    };
  }, [engineerInteractive, interactiveSession, sessionManager, sessionId]);

  useInput((input, key) => {
    if (engineerInteractive) return;

    if (input === "c" && key.ctrl) {
      if (sessionId) {
        for (const cmd of commands) {
          if (cmd.status === "running" || cmd.status === "approved"
            || (cmd.status === "pending" && cmd.output)) {
            sessionManager.killRunningCommand(sessionId, cmd.id);
          }
        }
      }
      exit();
      process.kill(process.pid, "SIGINT");
    }

    if (showSecretPanel) return;

    if (notification) {
      setNotification(null);
      return;
    }

    if (input === "s" && key.ctrl) {
      setShowSecretPanel(true);
      return;
    }

    if (input === "n" && key.ctrl) {
      if (confirmReset || !clientConnected) {
        createSession();
        setConfirmReset(false);
      } else {
        setConfirmReset(true);
        setTimeout(() => setConfirmReset(false), 3000);
      }
      return;
    }

    if (confirmReset && !(input === "n" && key.ctrl)) {
      setConfirmReset(false);
    }

    if (key.escape && sessionId) {
      if (interactiveSession) {
        sessionManager.killRunningCommand(sessionId, interactiveSession.commandId);
        setInteractiveSession(null);
        return;
      }

      const lastPending = sessionManager.getLastPendingCommandId(sessionId);
      if (lastPending) {
        sessionManager.cancelCommand(sessionId, lastPending);
        setCommands((prev) =>
          prev.map((cmd) =>
            cmd.id === lastPending
              ? { ...cmd, status: "denied" as const, deniedReason: "Cancelled by engineer" }
              : cmd,
          ),
        );
        return;
      }

      setCommands((prev) => {
        let killed = false;
        const updated = prev.map((cmd) => {
          if (cmd.status === "running" || cmd.status === "approved"
            || (cmd.status === "pending" && cmd.output)) {
            sessionManager.killRunningCommand(sessionId, cmd.id);
            killed = true;
            return { ...cmd, status: "denied" as const, deniedReason: "Cancelled by engineer" };
          }
          return cmd;
        });
        return killed ? updated : prev;
      });
      return;
    }

    if (inputIsActive) return;

    if (input === "c" && connectUrl) {
      copyToClipboard(`curl -sL shellshock.sh/get | bash -s -- "${connectUrl}"`);
      return;
    }
  });

  function handleCommandSubmit(raw: string) {
    if (!sessionId || !canSendCommands) return;

    const interactive = raw.startsWith("!");
    const command = interactive ? raw.slice(1).trimStart() : raw;
    if (!command) return;

    const commandId = sessionManager.requestCommand(sessionId, command, undefined, interactive);
    if (!commandId) return;

    const classification = interactive
      ? CommandClassification.Interactive
      : classifyCommand(command);
    const entry: CommandEntry = {
      id: commandId,
      command,
      status: "pending",
      classification,
    };

    setCommands((prev) => [...prev, entry]);
  }

  if (engineerInteractive) {
    return <Box />;
  }

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <StatusBar
        host={host}
        port={port}
        tunnelUrl={tunnelUrl}
        clientConnected={clientConnected}
        handshakeComplete={handshakeComplete}
        clientInfo={clientInfo}
      />

      {notification && (
        <Box
          borderStyle="round"
          borderColor="#9ece6a"
          paddingX={2}
          paddingY={1}
          flexDirection="column"
          marginX={1}
        >
          <Text color="#9ece6a" bold>
            {"✓ "}Session created — link copied to clipboard{tunnelUrl ? " (via ngrok)" : ""}
          </Text>
          <Text>{" "}</Text>
          <Text color="#7dcfff" bold>
            {"  "}{notification}
          </Text>
          <Text>{" "}</Text>
          <Text color="#565f89" dimColor>
            {"  "}Press any key to dismiss
          </Text>
        </Box>
      )}

      {showSecretPanel ? (
        <SecretSharePanel
          secretStore={secretStore}
          baseUrl={tunnelUrl ?? `http://${host}:${port}`}
          onClose={() => setShowSecretPanel(false)}
        />
      ) : (
        <Box flexDirection="column" flexGrow={1}>
          <Box flexGrow={1}>
            {connectUrl && !notification ? (
              <Box flexDirection="column" paddingX={2} paddingY={1}>
                <Text color="#7aa2f7" bold>{"⟡ Share this with the customer:"}</Text>
                <Text>{" "}</Text>
                <Text color="#e0af68">{"  "}curl -sL shellshock.sh/get | bash -s -- "{connectUrl}"</Text>
                <Text>{" "}</Text>
                {copied ? (
                  <Text color="#9ece6a" bold>{"  "}✓ Copied to clipboard</Text>
                ) : (
                  <Text color="#565f89" dimColor>{"  "}Press <Text color="#e0af68" bold>c</Text> to copy</Text>
                )}
                <Text>{" "}</Text>
                <Text color="#565f89" dimColor>{"  "}Waiting for client to connect...</Text>
              </Box>
            ) : !notification ? (
              <OutputStream commands={commands} maxHeight={20} />
            ) : null}
          </Box>

          {confirmReset && (
            <Box paddingX={2}>
              <Text color="#f7768e" bold>Reset session? Press Ctrl+N again to confirm.</Text>
            </Box>
          )}

          <Box
            borderStyle="single"
            borderColor={
              interactiveSession?.mode === "client" ? "#7dcfff" : "#3b4261"
            }
            borderTop={true}
            borderBottom={false}
            borderLeft={false}
            borderRight={false}
          >
            {interactiveSession?.mode === "client" ? (
              <Box paddingX={1}>
                <Text color="#7dcfff" bold>INTERACTIVE</Text>
                <Text color="#565f89">{" — client is in control. "}</Text>
                <Text color="#e0af68" bold>Escape</Text>
                <Text color="#565f89">{" to cancel"}</Text>
              </Box>
            ) : (
              <CommandInput
                sessionId={sessionId ?? ""}
                onSubmit={handleCommandSubmit}
                disabled={!sessionId || !canSendCommands}
                disabledReason={
                  !sessionId
                    ? "Creating session..."
                    : !clientConnected
                      ? "Waiting for client to connect..."
                      : !handshakeComplete
                        ? "Handshake in progress..."
                        : undefined
                }
              />
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}

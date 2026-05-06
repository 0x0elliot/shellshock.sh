import React, { useState, useEffect, useCallback } from "react";
import { execSync } from "node:child_process";
import { Box, Text, useInput, useApp } from "ink";
import type { SessionManager, ActiveSession } from "./session-manager.js";
import { StatusBar } from "./components/status-bar.js";
import {
  SessionList,
  type ActiveSessionInfo,
} from "./components/session-list.js";
import {
  OutputStream,
  type CommandEntry,
} from "./components/output-stream.js";
import { CommandInput } from "./components/command-input.js";
import {
  classifyCommand,
  type ClientInfo,
} from "@remote-debugger/shared";

interface AppProps {
  sessionManager: SessionManager;
  host: string;
  port: number;
}

function sessionToInfo(session: ActiveSession): ActiveSessionInfo {
  return {
    id: session.id,
    label: session.label,
    clientInfo: session.clientInfo,
    connected: session.clientSSE !== null,
    handshakeComplete: session.handshakeComplete,
    commandCount: session.pendingCommands.size,
  };
}

export function App({ sessionManager, host, port }: AppProps) {
  const { exit } = useApp();

  const [sessions, setSessions] = useState<ActiveSessionInfo[]>(() =>
    sessionManager.getActiveSessions().map(sessionToInfo)
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [commandsBySession, setCommandsBySession] = useState<
    Map<string, CommandEntry[]>
  >(new Map());
  const [notification, setNotification] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [interactiveSession, setInteractiveSession] = useState<{
    sessionId: string;
    commandId: string;
    mode: "client" | "engineer";
  } | null>(null);

  const refreshSessions = useCallback(() => {
    setSessions(sessionManager.getActiveSessions().map(sessionToInfo));
  }, [sessionManager]);

  useEffect(() => {
    function onClientConnected(_sessionId: string, _clientInfo: ClientInfo) {
      refreshSessions();
    }

    function onClientDisconnected(_sessionId: string, _reason: string) {
      refreshSessions();
    }

    function onHandshakeComplete(_sessionId: string) {
      refreshSessions();
    }

    function onSessionExpired(_sessionId: string) {
      refreshSessions();
    }

    function onCommandApproved(_sessionId: string, commandId: string) {
      setCommandsBySession((prev) => {
        const next = new Map(prev);
        for (const [sid, cmds] of next) {
          next.set(sid, cmds.map((cmd) =>
            cmd.id === commandId ? { ...cmd, status: "running" as const } : cmd
          ));
        }
        return next;
      });
    }

    function onCommandDenied(
      _sessionId: string,
      commandId: string,
      reason?: string
    ) {
      setCommandsBySession((prev) => {
        const next = new Map(prev);
        for (const [sid, cmds] of next) {
          next.set(sid, cmds.map((cmd) =>
            cmd.id === commandId ? { ...cmd, status: "denied" as const, deniedReason: reason } : cmd
          ));
        }
        return next;
      });
    }

    function onCommandOutput(
      _sessionId: string,
      commandId: string,
      _stream: string,
      data: string
    ) {
      setCommandsBySession((prev) => {
        const next = new Map(prev);
        for (const [sid, cmds] of next) {
          next.set(sid, cmds.map((cmd) =>
            cmd.id === commandId
              ? { ...cmd, output: (cmd.output ?? "") + data }
              : cmd
          ));
        }
        return next;
      });
    }

    function onCommandExit(
      _sessionId: string,
      commandId: string,
      exitCode: number | null,
      _signal: string | null
    ) {
      setCommandsBySession((prev) => {
        const next = new Map(prev);
        for (const [sid, cmds] of next) {
          next.set(sid, cmds.map((cmd) =>
            cmd.id === commandId
              ? {
                  ...cmd,
                  status: exitCode === 0 ? ("completed" as const) : ("failed" as const),
                  exitCode,
                }
              : cmd
          ));
        }
        return next;
      });
      setInteractiveSession((prev) =>
        prev && prev.commandId === commandId ? null : prev
      );
    }

    function onCommandCancelled(
      _sessionId: string,
      commandId: string
    ) {
      setCommandsBySession((prev) => {
        const next = new Map(prev);
        for (const [sid, cmds] of next) {
          next.set(sid, cmds.map((cmd) =>
            cmd.id === commandId
              ? { ...cmd, status: "denied" as const, deniedReason: "Cancelled" }
              : cmd
          ));
        }
        return next;
      });
    }

    function onInteractiveStarted(
      sid: string,
      commandId: string,
      mode: "client" | "engineer"
    ) {
      setInteractiveSession({ sessionId: sid, commandId, mode });
    }

    sessionManager.on("clientConnected", onClientConnected);
    sessionManager.on("clientDisconnected", onClientDisconnected);
    sessionManager.on("handshakeComplete", onHandshakeComplete);
    sessionManager.on("sessionExpired", onSessionExpired);
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
      sessionManager.off("sessionExpired", onSessionExpired);
      sessionManager.off("commandApproved", onCommandApproved);
      sessionManager.off("commandDenied", onCommandDenied);
      sessionManager.off("commandOutput", onCommandOutput);
      sessionManager.off("commandExit", onCommandExit);
      sessionManager.off("commandCancelled", onCommandCancelled);
      sessionManager.off("interactiveStarted", onInteractiveStarted);
    };
  }, [sessionManager, refreshSessions]);

  useEffect(() => {
    const interval = setInterval(refreshSessions, 2000);
    return () => clearInterval(interval);
  }, [refreshSessions]);

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

  const activeSession = sessions[activeIndex] ?? null;
  const activeSessionId = activeSession?.id ?? "";
  const activeCommands = activeSessionId
    ? commandsBySession.get(activeSessionId) ?? []
    : [];

  const canSendCommands = activeSession?.handshakeComplete === true;

  let connectUrl: string | null = null;
  if (activeSession && !activeSession.connected) {
    const raw = sessionManager.getSession(activeSessionId);
    if (raw) {
      connectUrl = `http://${host}:${port}/session/${raw.id}?token=${raw.token}`;
    }
  }

  const engineerInteractive = interactiveSession?.mode === "engineer"
    && interactiveSession.sessionId === activeSessionId;

  const inputIsActive = canSendCommands && !notification && !engineerInteractive;

  // Engineer-interactive keystroke relay
  useInput((input, key) => {
    if (!engineerInteractive || !interactiveSession) return;

    // Ctrl+] exits interactive mode
    if (key.ctrl && input === "]") {
      setInteractiveSession(null);
      return;
    }

    let data: string;
    if (key.return) data = "\r";
    else if (key.escape) data = "\x1b";
    else if (key.backspace || key.delete) data = "\x7f";
    else if (key.tab) data = "\t";
    else if (key.upArrow) data = "\x1b[A";
    else if (key.downArrow) data = "\x1b[B";
    else if (key.rightArrow) data = "\x1b[C";
    else if (key.leftArrow) data = "\x1b[D";
    else if (key.ctrl && input) {
      const code = input.toLowerCase().charCodeAt(0) - 96;
      data = code >= 1 && code <= 26 ? String.fromCharCode(code) : input;
    } else {
      data = input;
    }

    if (data) {
      sessionManager.sendInteractiveInput(
        interactiveSession.sessionId,
        interactiveSession.commandId,
        data,
      );
    }
  }, { isActive: engineerInteractive });

  useInput((input, key) => {
    if (engineerInteractive) return;

    if (notification) {
      setNotification(null);
      return;
    }

    // Ctrl-based shortcuts always work, even when typing
    if (input === "n" && key.ctrl) {
      const { sessionId, token } = sessionManager.createSession();
      const url = `http://${host}:${port}/session/${sessionId}?token=${token}`;

      setCommandsBySession((prev) => {
        const next = new Map(prev);
        next.set(sessionId, []);
        return next;
      });

      refreshSessions();

      const newSessions = sessionManager.getActiveSessions();
      const idx = newSessions.findIndex((s) => s.id === sessionId);
      if (idx !== -1) setActiveIndex(idx);

      copyToClipboard(`npx tsx packages/client/src/index.ts "${url}"`);
      setNotification(url);
      return;
    }

    if (input === "d" && key.ctrl && activeSessionId) {
      if (confirmClose) {
        sessionManager.closeSession(activeSessionId);
        setCommandsBySession((prev) => {
          const next = new Map(prev);
          next.delete(activeSessionId);
          return next;
        });
        refreshSessions();
        setActiveIndex((prev) => Math.max(0, prev - 1));
        setConfirmClose(false);
      } else {
        setConfirmClose(true);
        setTimeout(() => setConfirmClose(false), 3000);
      }
      return;
    }

    if (confirmClose) {
      setConfirmClose(false);
    }

    if (input === "c" && key.ctrl) {
      exit();
      process.kill(process.pid, "SIGINT");
    }

    // Escape cancels the last pending command
    if (key.escape && activeSessionId) {
      const lastPending = sessionManager.getLastPendingCommandId(activeSessionId);
      if (lastPending) {
        sessionManager.cancelCommand(activeSessionId, lastPending);
        setCommandsBySession((prev) => {
          const next = new Map(prev);
          const cmds = next.get(activeSessionId) ?? [];
          next.set(activeSessionId, cmds.map((cmd) =>
            cmd.id === lastPending ? { ...cmd, status: "denied" as const, deniedReason: "Cancelled by engineer" } : cmd
          ));
          return next;
        });
      }
      return;
    }

    // Single-key shortcuts only when text input is NOT focused
    if (inputIsActive) return;

    const num = parseInt(input, 10);
    if (num >= 1 && num <= 9 && num <= sessions.length) {
      setActiveIndex(num - 1);
      return;
    }

    if (input === "c" && connectUrl) {
      copyToClipboard(`npx tsx packages/client/src/index.ts "${connectUrl}"`);
      return;
    }

    if (key.upArrow && sessions.length > 1) {
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : sessions.length - 1));
      return;
    }

    if (key.downArrow && sessions.length > 1) {
      setActiveIndex((prev) => (prev < sessions.length - 1 ? prev + 1 : 0));
      return;
    }
  });

  function handleCommandSubmit(command: string) {
    if (!activeSessionId || !canSendCommands) return;

    const commandId = sessionManager.requestCommand(activeSessionId, command);
    if (!commandId) return;

    const classification = classifyCommand(command);
    const entry: CommandEntry = {
      id: commandId,
      command,
      status: "pending",
      classification,
    };

    setCommandsBySession((prev) => {
      const next = new Map(prev);
      const existing = next.get(activeSessionId) ?? [];
      next.set(activeSessionId, [...existing, entry]);
      return next;
    });
  }

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <StatusBar host={host} port={port} sessionCount={sessions.length} />

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
            {"✓ "}Session created — link copied to clipboard
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

      <Box flexDirection="row" flexGrow={1}>
        <Box
          width="30%"
          borderStyle="single"
          borderColor="#3b4261"
          borderRight={true}
          borderTop={false}
          borderBottom={false}
          borderLeft={false}
        >
          <SessionList
            sessions={sessions}
            activeIndex={activeIndex}
            onSelect={setActiveIndex}
          />
        </Box>

        <Box flexDirection="column" flexGrow={1}>
          <Box flexGrow={1}>
            {connectUrl ? (
              <Box flexDirection="column" paddingX={2} paddingY={1}>
                <Text color="#7aa2f7" bold>{"⟡ Share this with the customer:"}</Text>
                <Text>{" "}</Text>
                <Text color="#e0af68">{"  "}npx tsx packages/client/src/index.ts "{connectUrl}"</Text>
                <Text>{" "}</Text>
                {copied ? (
                  <Text color="#9ece6a" bold>{"  "}✓ Copied to clipboard</Text>
                ) : (
                  <Text color="#565f89" dimColor>{"  "}Press <Text color="#e0af68" bold>c</Text> to copy</Text>
                )}
                <Text>{" "}</Text>
                <Text color="#565f89" dimColor>{"  "}Waiting for client to connect...</Text>
              </Box>
            ) : (
              <OutputStream commands={activeCommands} maxHeight={20} />
            )}
          </Box>

          {confirmClose && (
            <Box paddingX={2}>
              <Text color="#f7768e" bold>Close session {activeSessionId.slice(0, 8)}? Press Ctrl+D again to confirm.</Text>
            </Box>
          )}

          <Box
            borderStyle="single"
            borderColor={engineerInteractive ? "#ff9e64" : "#3b4261"}
            borderTop={true}
            borderBottom={false}
            borderLeft={false}
            borderRight={false}
          >
            {engineerInteractive ? (
              <Box paddingX={1}>
                <Text color="#ff9e64" bold>INTERACTIVE</Text>
                <Text color="#565f89">{" — typing goes to remote command. "}</Text>
                <Text color="#e0af68" bold>Ctrl+]</Text>
                <Text color="#565f89">{" to detach"}</Text>
              </Box>
            ) : interactiveSession?.mode === "client"
                && interactiveSession.sessionId === activeSessionId ? (
              <Box paddingX={1}>
                <Text color="#7dcfff" bold>INTERACTIVE</Text>
                <Text color="#565f89">{" — client is in control"}</Text>
              </Box>
            ) : (
              <CommandInput
                sessionId={activeSessionId}
                onSubmit={handleCommandSubmit}
                disabled={!activeSession || !canSendCommands}
                disabledReason={
                  !activeSession
                    ? undefined
                    : !activeSession.connected
                      ? "Waiting for client to connect..."
                      : !activeSession.handshakeComplete
                        ? "Handshake in progress..."
                        : undefined
                }
              />
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

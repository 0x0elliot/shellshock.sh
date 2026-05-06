import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, useInput, useApp } from "ink";
import {
  type CommandRequest,
  type ClientToServerMessage,
  type CompoundPermissionEvaluation as CompoundEval,
  CommandClassification,
  classifyCommand,
  suggestRule,
  isCompoundCommand,
} from "@remote-debugger/shared";
import { useSSE } from "./hooks/use-sse.js";
import { usePermissions } from "./hooks/use-permissions.js";
import { useHandshake } from "./hooks/use-handshake.js";
import { executeCommand, executeInteractive } from "./executor.js";
import { StatusBar } from "./components/status-bar.js";
import { CommandLog, type CommandEntry } from "./components/command-log.js";
import { PermissionPrompt } from "./components/permission-prompt.js";
import { CompoundPermissionPrompt } from "./components/compound-permission-prompt.js";
import { AllowlistView } from "./components/allowlist-view.js";

interface AppProps {
  serverBaseUrl: string;
  sessionId: string;
  token: string;
}

function FooterShortcuts() {
  return (
    <Box paddingX={2} paddingTop={1}>
      <Text dimColor>
        <Text bold>[p]</Text> Permissions{"  "}
        <Text bold>[q]</Text> Quit{"  "}
        <Text bold>[Ctrl+C ×2]</Text> Emergency exit
      </Text>
    </Box>
  );
}

export default function App({ serverBaseUrl, sessionId, token }: AppProps) {
  const eventsUrl = `${serverBaseUrl}/api/sessions/${sessionId}/events?token=${token}`;
  const { connected, messages, error, reconnectCount } = useSSE(eventsUrl);
  const permissions = usePermissions(sessionId);
  const handshake = useHandshake(messages, serverBaseUrl, sessionId, token);
  const { exit } = useApp();

  const [commands, setCommands] = useState<CommandEntry[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState<{
    request: CommandRequest;
    classification: ReturnType<typeof classifyCommand>;
    suggested: string | null;
    compound: boolean;
  } | null>(null);
  const [pendingCompound, setPendingCompound] = useState<{
    request: CommandRequest;
    evaluation: CompoundEval;
  } | null>(null);
  const [commandQueue, setCommandQueue] = useState<CommandRequest[]>([]);
  const [showAllowlist, setShowAllowlist] = useState(false);
  const [interactiveRun, setInteractiveRun] = useState<CommandRequest | null>(null);

  const processedIdsRef = useRef<Set<string>>(new Set());
  const killersRef = useRef<Map<string, () => void>>(new Map());

  const isPromptActive = pendingPrompt !== null || pendingCompound !== null;

  const postToServer = useCallback(
    async (msg: ClientToServerMessage) => {
      const url = `${serverBaseUrl}/api/sessions/${sessionId}/respond?token=${token}`;
      const body = JSON.stringify(msg);
      const maxRetries = 3;
      const baseDelay = 500;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          });
          if (res.ok) return;
          if (res.status >= 400 && res.status < 500) return;
        } catch {
          // Network error — retry
        }
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, baseDelay * Math.pow(2, attempt)));
        }
      }
    },
    [serverBaseUrl, sessionId, token],
  );

  const startExecution = useCallback(
    (request: CommandRequest) => {
      setCommands((prev) =>
        prev.map((c) => (c.id === request.id ? { ...c, status: "running" as const } : c)),
      );

      const handle = executeCommand(
        request.command,
        request.cwd,
        (data) => {
          setCommands((prev) =>
            prev.map((c) =>
              c.id === request.id ? { ...c, output: (c.output || "") + data } : c,
            ),
          );
          postToServer({ type: "command_output", id: request.id, stream: "stdout", data });
        },
        (data) => {
          setCommands((prev) =>
            prev.map((c) =>
              c.id === request.id ? { ...c, output: (c.output || "") + data } : c,
            ),
          );
          postToServer({ type: "command_output", id: request.id, stream: "stderr", data });
        },
        (code, signal) => {
          setCommands((prev) =>
            prev.map((c) =>
              c.id === request.id
                ? {
                    ...c,
                    status: (code === 0 ? "completed" : "failed") as "completed" | "failed",
                    exitCode: code,
                  }
                : c,
            ),
          );
          killersRef.current.delete(request.id);
          postToServer({ type: "command_exit", id: request.id, exitCode: code, signal });
        },
      );

      killersRef.current.set(request.id, handle.kill);
    },
    [postToServer],
  );

  // --- Simple command handlers ---

  const handleAllow = useCallback(
    (id: string) => {
      if (!pendingPrompt || pendingPrompt.request.id !== id) return;

      const request = pendingPrompt.request;
      const isInteractive = pendingPrompt.classification === CommandClassification.Interactive;
      setPendingPrompt(null);

      postToServer({ type: "command_approved", id });
      setCommands((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status: "approved" as const } : c)),
      );

      if (isInteractive) {
        setInteractiveRun(request);
      } else {
        startExecution(request);
      }
      processQueue();
    },
    [pendingPrompt, postToServer, startExecution],
  );

  const handleDeny = useCallback(
    (id: string, reason?: string) => {
      if (!pendingPrompt || pendingPrompt.request.id !== id) return;

      setPendingPrompt(null);
      postToServer({ type: "command_denied", id, reason });
      setCommands((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, status: "denied" as const, deniedReason: reason } : c,
        ),
      );

      processQueue();
    },
    [pendingPrompt, postToServer],
  );

  const handleAllowPattern = useCallback(
    (id: string, rule: string) => {
      permissions.addAllowRule(rule);
      handleAllow(id);
    },
    [permissions, handleAllow],
  );

  // --- Compound command handlers ---

  const handleCompoundAllApproved = useCallback(
    (id: string) => {
      if (!pendingCompound || pendingCompound.request.id !== id) return;

      const request = pendingCompound.request;
      setPendingCompound(null);

      postToServer({ type: "command_approved", id });
      setCommands((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status: "approved" as const } : c)),
      );

      startExecution(request);
      processQueue();
    },
    [pendingCompound, postToServer, startExecution],
  );

  const handleCompoundDeny = useCallback(
    (id: string, reason: string) => {
      if (!pendingCompound || pendingCompound.request.id !== id) return;

      setPendingCompound(null);
      postToServer({ type: "command_denied", id, reason });
      setCommands((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, status: "denied" as const, deniedReason: reason } : c,
        ),
      );

      processQueue();
    },
    [pendingCompound, postToServer],
  );

  const handleCompoundAllowPattern = useCallback(
    (_id: string, rule: string) => {
      permissions.addAllowRule(rule);
    },
    [permissions],
  );

  // --- Queue ---

  const processQueue = useCallback(() => {
    setCommandQueue((prevQueue) => {
      if (prevQueue.length === 0) return prevQueue;
      const [next, ...rest] = prevQueue;
      setTimeout(() => processRequest(next), 0);
      return rest;
    });
  }, []);

  // --- Request processing ---

  const processRequest = useCallback(
    (request: CommandRequest) => {
      const compound = isCompoundCommand(request.command);

      setCommands((prev) => {
        if (prev.some((c) => c.id === request.id)) return prev;
        const classification = classifyCommand(request.command);
        return [
          ...prev,
          { id: request.id, command: request.command, status: "pending" as const, classification },
        ];
      });

      if (compound) {
        // Evaluate per-group for compound commands
        const compoundEval = permissions.evaluateCompound(request.command);

        if (compoundEval.overallDecision === "allow") {
          postToServer({ type: "command_approved", id: request.id });
          setCommands((prev) =>
            prev.map((c) => (c.id === request.id ? { ...c, status: "approved" as const } : c)),
          );
          startExecution(request);
        } else if (compoundEval.overallDecision === "deny") {
          postToServer({ type: "command_denied", id: request.id, reason: compoundEval.denyReason });
          setCommands((prev) =>
            prev.map((c) =>
              c.id === request.id
                ? { ...c, status: "denied" as const, deniedReason: compoundEval.denyReason }
                : c,
            ),
          );
        } else {
          // Show compound prompt — queue if another prompt is active
          if (isPromptActive) {
            setCommandQueue((prev) => [...prev, request]);
          } else {
            setPendingCompound({ request, evaluation: compoundEval });
          }
        }
      } else {
        // Simple command — existing flow
        const evaluation = permissions.evaluate(request.command);
        const classification = evaluation.classification;
        const suggested = suggestRule(request.command);

        if (evaluation.decision === "allow") {
          postToServer({ type: "command_approved", id: request.id });
          setCommands((prev) =>
            prev.map((c) => (c.id === request.id ? { ...c, status: "approved" as const } : c)),
          );
          startExecution(request);
        } else if (evaluation.decision === "deny") {
          postToServer({ type: "command_denied", id: request.id, reason: evaluation.reason });
          setCommands((prev) =>
            prev.map((c) =>
              c.id === request.id
                ? { ...c, status: "denied" as const, deniedReason: evaluation.reason }
                : c,
            ),
          );
        } else {
          if (isPromptActive) {
            setCommandQueue((prev) => [...prev, request]);
          } else {
            setPendingPrompt({ request, classification, suggested, compound: false });
          }
        }
      }
    },
    [permissions, postToServer, startExecution, isPromptActive],
  );

  // Only process command messages after handshake is complete
  useEffect(() => {
    if (handshake.state !== "complete") return;

    for (const msg of messages) {
      if (msg.type === "command_request") {
        if (processedIdsRef.current.has(msg.id)) continue;
        processedIdsRef.current.add(msg.id);
        processRequest(msg);
      }

      if (msg.type === "command_cancel") {
        // Dismiss prompt if it's for this command
        setPendingPrompt((current) => {
          if (current && current.request.id === msg.id) return null;
          return current;
        });
        setPendingCompound((current) => {
          if (current && current.request.id === msg.id) return null;
          return current;
        });
        // Remove from queue
        setCommandQueue((prev) => prev.filter((r) => r.id !== msg.id));
        // Mark as cancelled in the log
        setCommands((prev) =>
          prev.map((c) =>
            c.id === msg.id
              ? { ...c, status: "denied" as const, deniedReason: "Cancelled by engineer" }
              : c,
          ),
        );
      }
    }
  }, [messages, processRequest, handshake.state]);

  // Interactive command execution — suspends TUI, gives terminal to the child
  useEffect(() => {
    if (!interactiveRun) return;

    const request = interactiveRun;

    process.stdout.write("\x1B[?1049l"); // exit alternate screen

    executeInteractive(request.command, request.cwd).then(({ code, signal }) => {
      process.stdout.write("\x1B[?1049h"); // re-enter alternate screen

      setCommands((prev) =>
        prev.map((c) =>
          c.id === request.id
            ? { ...c, status: (code === 0 ? "completed" : "failed") as "completed" | "failed", exitCode: code }
            : c,
        ),
      );

      postToServer({ type: "command_exit", id: request.id, exitCode: code, signal });
      setInteractiveRun(null);
    });
  }, [interactiveRun, postToServer]);

  useInput(
    (input, key) => {
      if (isPromptActive) return;

      if (input === "p" || input === "P") {
        setShowAllowlist((prev) => !prev);
      }

      if (input === "q" || input === "Q" || (key.ctrl && input === "c")) {
        for (const kill of killersRef.current.values()) {
          kill();
        }
        exit();
      }
    },
    { isActive: !showAllowlist },
  );

  const ruleCount = permissions.allowRules.length + permissions.denyRules.length;

  if (interactiveRun) {
    return <Box />;
  }

  if (showAllowlist) {
    return (
      <Box flexDirection="column" width="100%">
        <AllowlistView
          allowRules={permissions.allowRules}
          denyRules={permissions.denyRules}
          onDelete={permissions.removeRule}
          onClose={() => setShowAllowlist(false)}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="100%">
      <StatusBar
        connected={connected}
        sessionId={sessionId}
        reconnectCount={reconnectCount}
        ruleCount={ruleCount}
        handshakeState={handshake.state}
      />

      {error && !connected && (
        <Box paddingX={2}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}

      {handshake.state === "failed" && handshake.error && (
        <Box paddingX={2} paddingY={1}>
          <Text color="#f7768e">Handshake error: {handshake.error}</Text>
        </Box>
      )}

      <CommandLog commands={commands} />

      {pendingCompound ? (
        <CompoundPermissionPrompt
          originalCommand={pendingCompound.request.command}
          commandId={pendingCompound.request.id}
          promptSegments={pendingCompound.evaluation.promptSegments}
          totalSegments={pendingCompound.evaluation.segments.length}
          onAllApproved={handleCompoundAllApproved}
          onDeny={handleCompoundDeny}
          onAllowPattern={handleCompoundAllowPattern}
        />
      ) : pendingPrompt ? (
        <PermissionPrompt
          command={pendingPrompt.request.command}
          commandId={pendingPrompt.request.id}
          classification={pendingPrompt.classification}
          suggestedRule={pendingPrompt.suggested}
          isCompound={false}
          onAllow={handleAllow}
          onDeny={handleDeny}
          onAllowPattern={handleAllowPattern}
        />
      ) : (
        <FooterShortcuts />
      )}
    </Box>
  );
}

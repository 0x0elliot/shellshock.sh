import React, { useState, useEffect, useCallback, useRef } from "react";
import fs from "node:fs";
import path from "node:path";
import { Box, Text, useInput, useApp } from "ink";
import {
  type CommandRequest,
  type ClientToServerMessage,
  type CompoundPermissionEvaluation as CompoundEval,
  type EncryptedEnvelope,
  type ServerToClientMessage,
  CommandClassification,
  classifyCommand,
  suggestRule,
  isCompoundCommand,
  encryptMessage,
  decryptMessage,
} from "shellshock.sh-shared";
import { useSSE } from "./hooks/use-sse.js";
import { usePermissions } from "./hooks/use-permissions.js";
import { useHandshake } from "./hooks/use-handshake.js";
import { useOutputBuffer } from "./hooks/use-output-buffer.js";
import { executeCommand, executePTY, executeInteractive, type PTYHandle } from "./executor.js";
import { StatusBar } from "./components/status-bar.js";
import { CommandLog, type CommandEntry } from "./components/command-log.js";
import { PermissionPrompt } from "./components/permission-prompt.js";
import { CompoundPermissionPrompt } from "./components/compound-permission-prompt.js";
import { AllowlistView } from "./components/allowlist-view.js";
import { InteractiveChoice, type InteractiveChoiceResult } from "./components/interactive-choice.js";


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
  const [interactiveChoice, setInteractiveChoice] = useState<CommandRequest | null>(null);
  const [interactiveRun, setInteractiveRun] = useState<{
    request: CommandRequest;
    mode: "client" | "engineer";
  } | null>(null);

  const processedIdsRef = useRef<Set<string>>(new Set());
  const processedMsgCountRef = useRef(0);
  const killersRef = useRef<Map<string, () => void>>(new Map());
  const ptyRef = useRef<PTYHandle | null>(null);
  const sessionKeyRef = useRef<Buffer | null>(null);
  sessionKeyRef.current = handshake.sessionKey;
  const cwdRef = useRef(process.cwd());

  const pushOutput = useOutputBuffer(
    useCallback((merged: Map<string, string>) => {
      setCommands((prev) => {
        let next = prev;
        for (const [cmdId, data] of merged) {
          next = next.map((c) =>
            c.id === cmdId ? { ...c, output: (c.output || "") + data } : c,
          );
        }
        return next;
      });
    }, []),
  );

  const isPromptActive = pendingPrompt !== null || pendingCompound !== null || interactiveChoice !== null;

  const postToServer = useCallback(
    async (msg: ClientToServerMessage) => {
      const url = `${serverBaseUrl}/api/sessions/${sessionId}/respond?token=${token}`;
      const key = sessionKeyRef.current;
      const body = key
        ? JSON.stringify({ _enc: encryptMessage(key, JSON.stringify(msg)) })
        : JSON.stringify(msg);
      const maxRetries = 3;
      const baseDelay = 500;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "ngrok-skip-browser-warning": "1",
            },
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
      const effectiveCwd = request.cwd || cwdRef.current;

      const cdMatch = request.command.match(/^\s*cd(?:\s+(.*))?\s*$/);
      if (cdMatch) {
        const target = (cdMatch[1] || "").trim().replace(/^["']|["']$/g, "") || process.env.HOME || "/";
        const resolved = target === "~"
          ? (process.env.HOME || "/")
          : path.resolve(effectiveCwd, target.replace(/^~\//, (process.env.HOME || "") + "/"));
        try {
          const stat = fs.statSync(resolved);
          if (!stat.isDirectory()) throw new Error("Not a directory");
          cwdRef.current = resolved;
          const data = `${resolved}\n`;
          pushOutput(request.id, data);
          postToServer({ type: "command_output", id: request.id, stream: "stdout", data });
          setCommands((prev) =>
            prev.map((c) =>
              c.id === request.id ? { ...c, status: "completed" as const, exitCode: 0 } : c,
            ),
          );
          postToServer({ type: "command_exit", id: request.id, exitCode: 0, signal: null });
        } catch (err) {
          const errMsg = `cd: ${target}: ${err instanceof Error ? err.message : "No such file or directory"}\n`;
          pushOutput(request.id, errMsg);
          postToServer({ type: "command_output", id: request.id, stream: "stderr", data: errMsg });
          setCommands((prev) =>
            prev.map((c) =>
              c.id === request.id ? { ...c, status: "failed" as const, exitCode: 1 } : c,
            ),
          );
          postToServer({ type: "command_exit", id: request.id, exitCode: 1, signal: null });
        }
        return;
      }

      setCommands((prev) =>
        prev.map((c) => (c.id === request.id ? { ...c, status: "running" as const } : c)),
      );

      const handle = executeCommand(
        request.command,
        effectiveCwd,
        (data) => {
          pushOutput(request.id, data);
          postToServer({ type: "command_output", id: request.id, stream: "stdout", data });
        },
        (data) => {
          pushOutput(request.id, data);
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
    [postToServer, pushOutput],
  );

  // --- Simple command handlers ---

  const handleAllow = useCallback(
    (id: string) => {
      if (!pendingPrompt || pendingPrompt.request.id !== id) return;

      const request = pendingPrompt.request;
      const isInteractive = pendingPrompt.classification === CommandClassification.Interactive;
      setPendingPrompt(null);

      if (isInteractive) {
        setInteractiveChoice(request);
      } else {
        postToServer({ type: "command_approved", id });
        setCommands((prev) =>
          prev.map((c) => (c.id === id ? { ...c, status: "approved" as const } : c)),
        );
        startExecution(request);
        processQueue();
      }
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

  // --- Interactive mode choice ---

  const handleInteractiveChoice = useCallback(
    (choice: InteractiveChoiceResult) => {
      if (!interactiveChoice) return;

      const request = interactiveChoice;
      setInteractiveChoice(null);

      if (choice === "deny") {
        postToServer({ type: "command_denied", id: request.id, reason: "Denied by client" });
        setCommands((prev) =>
          prev.map((c) =>
            c.id === request.id ? { ...c, status: "denied" as const, deniedReason: "Denied by client" } : c,
          ),
        );
        processQueue();
        return;
      }

      postToServer({ type: "command_approved", id: request.id });
      postToServer({ type: "interactive_mode", id: request.id, mode: choice });
      setCommands((prev) =>
        prev.map((c) => (c.id === request.id ? { ...c, status: "approved" as const } : c)),
      );
      setInteractiveRun({ request, mode: choice });
    },
    [interactiveChoice, postToServer],
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
      const classification = request.interactive
        ? CommandClassification.Interactive
        : classifyCommand(request.command);

      setCommands((prev) => {
        if (prev.some((c) => c.id === request.id)) return prev;
        return [
          ...prev,
          { id: request.id, command: request.command, status: "pending" as const, classification },
        ];
      });

      if (request.interactive) {
        const evaluation = permissions.evaluate(request.command);
        if (evaluation.decision === "deny") {
          postToServer({ type: "command_denied", id: request.id, reason: evaluation.reason });
          setCommands((prev) =>
            prev.map((c) =>
              c.id === request.id
                ? { ...c, status: "denied" as const, deniedReason: evaluation.reason }
                : c,
            ),
          );
        } else if (isPromptActive) {
          setCommandQueue((prev) => [...prev, request]);
        } else {
          setInteractiveChoice(request);
        }
        return;
      }

      const compound = isCompoundCommand(request.command);

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
          if (classification === CommandClassification.Interactive) {
            if (isPromptActive) {
              setCommandQueue((prev) => [...prev, request]);
            } else {
              setInteractiveChoice(request);
            }
          } else {
            postToServer({ type: "command_approved", id: request.id });
            setCommands((prev) =>
              prev.map((c) => (c.id === request.id ? { ...c, status: "approved" as const } : c)),
            );
            startExecution(request);
          }
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

  // Process SSE messages (commands, cancellations, interactive input)
  useEffect(() => {
    if (handshake.state !== "complete") return;

    const key = handshake.sessionKey;

    for (let i = processedMsgCountRef.current; i < messages.length; i++) {
      const raw = messages[i];

      let msg: ServerToClientMessage;
      if ("_enc" in raw) {
        if (!key) continue;
        try {
          msg = JSON.parse(decryptMessage(key, raw._enc));
        } catch {
          continue;
        }
      } else {
        msg = raw;
      }

      if (msg.type === "interactive_input") {
        ptyRef.current?.write(msg.data);
        continue;
      }

      if (msg.type === "interactive_resize") {
        ptyRef.current?.resize(msg.cols, msg.rows);
        continue;
      }

      if (msg.type === "command_request") {
        if (processedIdsRef.current.has(msg.id)) continue;
        processedIdsRef.current.add(msg.id);
        processRequest(msg);
      }

      if (msg.type === "command_cancel") {
        const killer = killersRef.current.get(msg.id);
        if (killer) {
          killer();
          killersRef.current.delete(msg.id);
        }
        setPendingPrompt((current) => {
          if (current && current.request.id === msg.id) return null;
          return current;
        });
        setPendingCompound((current) => {
          if (current && current.request.id === msg.id) return null;
          return current;
        });
        setInteractiveChoice((current) => {
          if (current && current.id === msg.id) return null;
          return current;
        });
        setInteractiveRun((current) => {
          if (current && current.request.id === msg.id) return null;
          return current;
        });
        setCommandQueue((prev) => prev.filter((r) => r.id !== msg.id));
        setCommands((prev) =>
          prev.map((c) =>
            c.id === msg.id
              ? { ...c, status: "denied" as const, deniedReason: "Cancelled by engineer" }
              : c,
          ),
        );
        setTimeout(() => processQueue(), 0);
      }
    }
    processedMsgCountRef.current = messages.length;
  }, [messages, processRequest, handshake.state]);

  // Trap SIGINT during interactive runs so Ctrl+C kills only the child, not the session
  useEffect(() => {
    if (!interactiveRun) return;

    const prevListeners = process.rawListeners("SIGINT").slice();
    process.removeAllListeners("SIGINT");
    process.on("SIGINT", () => {});

    return () => {
      process.removeAllListeners("SIGINT");
      for (const l of prevListeners) {
        process.on("SIGINT", l as (...args: unknown[]) => void);
      }
    };
  }, [interactiveRun]);

  // Client-interactive mode — hand the terminal directly to the child process.
  // stdio:"inherit" gives the child direct fd 0/1/2 ownership. No PTY, no
  // stdin forwarding, no terminal response filtering needed.
  useEffect(() => {
    if (!interactiveRun || interactiveRun.mode !== "client") return;

    const request = interactiveRun.request;
    let cancelled = false;

    const savedDataListeners = process.stdin.rawListeners("data").slice();
    const savedKeypressListeners = process.stdin.rawListeners("keypress").slice();
    process.stdin.removeAllListeners("data");
    process.stdin.removeAllListeners("keypress");

    const rawStdoutWrite = process.stdout.write.bind(process.stdout) as typeof process.stdout.write;
    (process.stdout as any).write = (() => true) as any;

    rawStdoutWrite("\x1b[?1003l\x1b[?1006l\x1b[?1002l\x1b[?1000l");
    rawStdoutWrite("\x1B[?1049l");

    (async () => {
      const { code, signal } = await executeInteractive(
        request.command,
        request.cwd || cwdRef.current,
      );

      (process.stdout as any).write = rawStdoutWrite;
      process.stdout.write("\x1B[?1049h");

      process.stdin.removeAllListeners("data");
      process.stdin.removeAllListeners("keypress");
      for (const l of savedDataListeners) process.stdin.on("data", l as (...args: unknown[]) => void);
      for (const l of savedKeypressListeners) process.stdin.on("keypress", l as (...args: unknown[]) => void);

      if (cancelled) return;

      setCommands((prev) =>
        prev.map((c) =>
          c.id === request.id
            ? { ...c, status: (code === 0 ? "completed" : "failed") as "completed" | "failed", exitCode: code }
            : c,
        ),
      );
      postToServer({ type: "command_exit", id: request.id, exitCode: code, signal });
      setInteractiveRun(null);
      processQueue();
    })();

    return () => { cancelled = true; };
  }, [interactiveRun, postToServer]);

  // Engineer-interactive mode — PTY with remote keystroke relay
  useEffect(() => {
    if (!interactiveRun || interactiveRun.mode !== "engineer") return;

    const request = interactiveRun.request;

    // Suppress Ink stdout writes (same reason as client mode)
    const rawStdoutWrite = process.stdout.write.bind(process.stdout) as typeof process.stdout.write;
    (process.stdout as any).write = (() => true) as any;

    rawStdoutWrite("\x1B[?1049l");

    const handle = executePTY(
      request.command,
      request.cwd || cwdRef.current,
      (data) => {
        rawStdoutWrite(data);
        postToServer({ type: "interactive_output", id: request.id, data });
      },
      (code, signal) => {
        (process.stdout as any).write = rawStdoutWrite;
        process.stdout.write("\x1B[?1049h");
        ptyRef.current = null;

        setCommands((prev) =>
          prev.map((c) =>
            c.id === request.id
              ? { ...c, status: (code === 0 ? "completed" : "failed") as "completed" | "failed", exitCode: code }
              : c,
          ),
        );

        postToServer({ type: "command_exit", id: request.id, exitCode: code, signal });
        setInteractiveRun(null);
        processQueue();
      },
    );

    ptyRef.current = handle;

    return () => {
      if (ptyRef.current === handle) {
        (process.stdout as any).write = rawStdoutWrite;
        handle.kill();
        ptyRef.current = null;
      }
    };
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
    { isActive: !showAllowlist && !interactiveRun },
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

      {interactiveChoice ? (
        <InteractiveChoice
          command={interactiveChoice.command}
          commandId={interactiveChoice.id}
          onChoice={handleInteractiveChoice}
        />
      ) : pendingCompound ? (
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

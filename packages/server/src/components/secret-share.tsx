import React, { useState, useEffect, useCallback } from "react";
import { execSync } from "node:child_process";
import { Box, Text, useInput } from "ink";
import { AnimatedSpinner } from "./animated-spinner.js";
import type { SecretStore, SecretEntry } from "../secret-store.js";

interface SecretSharePanelProps {
  secretStore: SecretStore;
  baseUrl: string;
  onClose: () => void;
}

type Phase =
  | { type: "input" }
  | { type: "waiting"; entry: SecretEntry; fetchUrl: string }
  | { type: "retrieved"; ip: string }
  | { type: "expired" };

export function SecretSharePanel({
  secretStore,
  baseUrl,
  onClose,
}: SecretSharePanelProps) {
  const [phase, setPhase] = useState<Phase>({ type: "input" });
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const [copied, setCopied] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);

  const copyToClipboard = useCallback((text: string): boolean => {
    const cmds: Record<string, string[]> = {
      darwin: ["pbcopy"],
      win32: ["clip"],
      linux: [
        "xclip -selection clipboard",
        "xsel --clipboard --input",
        "wl-copy",
      ],
    };
    const candidates = cmds[process.platform] ?? cmds.linux;
    for (const cmd of candidates) {
      try {
        execSync(cmd, { input: text, stdio: ["pipe", "ignore", "ignore"] });
        return true;
      } catch {
        /* try next */
      }
    }
    return false;
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 3000);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (phase.type !== "waiting") {
      setRemaining(null);
      return;
    }
    const tick = () => {
      const secs = Math.max(
        0,
        Math.ceil((phase.entry.expiresAt - Date.now()) / 1000)
      );
      setRemaining(secs);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [phase]);

  useEffect(() => {
    if (phase.type !== "waiting") return;
    const { authId } = phase.entry;

    const onRetrieved = (id: string, ip: string) => {
      if (id === authId) setPhase({ type: "retrieved", ip });
    };
    const onExpired = (id: string) => {
      if (id === authId) setPhase({ type: "expired" });
    };

    secretStore.on("retrieved", onRetrieved);
    secretStore.on("expired", onExpired);
    return () => {
      secretStore.off("retrieved", onRetrieved);
      secretStore.off("expired", onExpired);
    };
  }, [phase, secretStore]);

  function submitSecret() {
    const trimmed = value.trim();
    if (!trimmed) return;

    const entry = secretStore.create(trimmed, 15);
    const fetchUrl = `${baseUrl}/s/${entry.authId}`;
    setPhase({ type: "waiting", entry, fetchUrl });

    const cmd = `curl -sf -H "X-Shellshock: 1" -H "ngrok-skip-browser-warning: 1" ${fetchUrl} | openssl enc -aes-256-cbc -d -a -md sha256 -pass pass:${entry.decryptKey} 2>/dev/null || echo "Error: secret not found or already retrieved"`;
    if (copyToClipboard(cmd)) setCopied(true);
  }

  function copyRecipientCmd() {
    if (phase.type !== "waiting") return;
    const cmd = `curl -sf -H "X-Shellshock: 1" -H "ngrok-skip-browser-warning: 1" ${phase.fetchUrl} | openssl enc -aes-256-cbc -d -a -md sha256 -pass pass:${phase.entry.decryptKey} 2>/dev/null || echo "Error: secret not found or already retrieved"`;
    if (copyToClipboard(cmd)) setCopied(true);
  }

  useInput((input, key) => {
    if (key.escape) {
      if (phase.type === "waiting") {
        secretStore.cancel(phase.entry.authId);
      }
      onClose();
      return;
    }

    if (phase.type === "retrieved" || phase.type === "expired") {
      onClose();
      return;
    }

    if (phase.type === "waiting") {
      if (input === "c") {
        copyRecipientCmd();
      }
      return;
    }

    // --- Input phase ---
    if (key.return) {
      submitSecret();
      return;
    }

    if (key.leftArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor((c) => Math.min(value.length, c + 1));
      return;
    }
    if (input === "a" && key.ctrl) {
      setCursor(0);
      return;
    }
    if (input === "e" && key.ctrl) {
      setCursor(value.length);
      return;
    }
    if (input === "u" && key.ctrl) {
      setValue(value.slice(cursor));
      setCursor(0);
      return;
    }
    if (input === "k" && key.ctrl) {
      setValue(value.slice(0, cursor));
      return;
    }
    if (key.backspace || key.delete) {
      if (cursor === 0) return;
      setValue(value.slice(0, cursor - 1) + value.slice(cursor));
      setCursor(cursor - 1);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setValue(value.slice(0, cursor) + input + value.slice(cursor));
      setCursor(cursor + input.length);
    }
  });

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  if (phase.type === "input") {
    const before = value.slice(0, cursor);
    const cursorChar = value[cursor] ?? " ";
    const after = value.slice(cursor + 1);

    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Box
          borderStyle="round"
          borderColor="#7aa2f7"
          flexDirection="column"
          paddingX={2}
          paddingY={1}
          marginY={1}
        >
          <Text color="#7aa2f7" bold>
            {"  "}Share a Secret
          </Text>
          <Text>{" "}</Text>
          <Text color="#a9b1d6">
            {"  "}Type the secret you want to share:
          </Text>
          <Text>{" "}</Text>
          <Box paddingX={2}>
            <Text color="#bb9af7" bold>
              {"› "}
            </Text>
            <Text>{before}</Text>
            <Text inverse>{cursorChar}</Text>
            <Text>{after}</Text>
          </Box>
          <Text>{" "}</Text>
          <Text color="#565f89" dimColor>
            {"  "}
            <Text color="#e0af68">Enter</Text> share{"  |  "}
            <Text color="#e0af68">Escape</Text> cancel
          </Text>
          <Text>{" "}</Text>
          <Text color="#565f89" dimColor>
            {"  "}Encrypted end-to-end — decryption key never reaches the
            server
          </Text>
        </Box>
      </Box>
    );
  }

  if (phase.type === "waiting") {
    const directCmd = `curl -sf -H "X-Shellshock: 1" -H "ngrok-skip-browser-warning: 1" ${phase.fetchUrl} | openssl enc -aes-256-cbc -d -a -md sha256 -pass pass:${phase.entry.decryptKey} 2>/dev/null || echo "Error: secret not found or already retrieved"`;
    const scriptCmd = `curl -sL shellshock.sh/secret | bash -s -- ${phase.fetchUrl} ${phase.entry.decryptKey}`;

    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Box
          borderStyle="round"
          borderColor="#e0af68"
          flexDirection="column"
          paddingX={2}
          paddingY={1}
          marginY={1}
        >
          <Text color="#9ece6a" bold>
            {"  "}✓ Secret encrypted ({phase.entry.plaintextLength} bytes)
          </Text>
          <Text>{" "}</Text>
          <Text color="#a9b1d6">{"  "}Recipient command:</Text>
          <Text>{" "}</Text>
          <Text color="#7dcfff">{"    "}{directCmd}</Text>
          <Text>{" "}</Text>
          <Text color="#565f89" dimColor>{"  "}Or via helper script:</Text>
          <Text>{" "}</Text>
          <Text color="#565f89">{"    "}{scriptCmd}</Text>
          <Text>{" "}</Text>
          {copied ? (
            <Text color="#9ece6a" bold>
              {"  "}✓ Copied to clipboard
            </Text>
          ) : (
            <Text color="#565f89" dimColor>
              {"  "}Press <Text color="#e0af68">c</Text> to copy
            </Text>
          )}
          <Text>{" "}</Text>
          <Box>
            <Text>{"  "}</Text>
            <AnimatedSpinner label="Waiting for retrieval..." color="#e0af68" />
            {remaining !== null && (
              <Text color="#565f89">
                {"  "}expires in {formatTime(remaining)}
              </Text>
            )}
          </Box>
          <Text>{" "}</Text>
          <Text color="#565f89" dimColor>
            {"  "}Burns after first retrieval{"  |  "}
            <Text color="#e0af68">Escape</Text> cancel + destroy
          </Text>
        </Box>
      </Box>
    );
  }

  if (phase.type === "retrieved") {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Box
          borderStyle="round"
          borderColor="#9ece6a"
          flexDirection="column"
          paddingX={2}
          paddingY={1}
          marginY={1}
        >
          <Text color="#9ece6a" bold>
            {"  "}✓ Secret Retrieved
          </Text>
          <Text>{" "}</Text>
          <Text color="#a9b1d6">
            {"  "}Retrieved by{" "}
            <Text color="#7dcfff" bold>
              {phase.ip}
            </Text>
          </Text>
          <Text>{" "}</Text>
          <Text color="#565f89" dimColor>
            {"  "}Secret has been destroyed from memory.
          </Text>
          <Text>{" "}</Text>
          <Text color="#565f89" dimColor>
            {"  "}Press any key to dismiss
          </Text>
        </Box>
      </Box>
    );
  }

  // expired
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box
        borderStyle="round"
        borderColor="#f7768e"
        flexDirection="column"
        paddingX={2}
        paddingY={1}
        marginY={1}
      >
        <Text color="#f7768e" bold>
          {"  "}Secret Expired
        </Text>
        <Text>{" "}</Text>
        <Text color="#a9b1d6">
          {"  "}Secret expired — not retrieved.
        </Text>
        <Text color="#565f89" dimColor>
          {"  "}It has been destroyed from memory.
        </Text>
        <Text>{" "}</Text>
        <Text color="#565f89" dimColor>
          {"  "}Press any key to dismiss
        </Text>
      </Box>
    </Box>
  );
}

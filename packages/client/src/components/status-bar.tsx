import React from "react";
import { Box, Text } from "ink";
import type { HandshakeState } from "../hooks/use-handshake.js";
import { AnimatedSpinner } from "./animated-spinner.js";

interface StatusBarProps {
  connected: boolean;
  sessionId: string;
  reconnectCount: number;
  ruleCount: number;
  handshakeState: HandshakeState;
}

export function StatusBar({
  connected,
  sessionId,
  reconnectCount,
  ruleCount,
  handshakeState,
}: StatusBarProps) {
  const shortId = sessionId.slice(0, 8);

  const ready = connected && handshakeState === "complete";

  return (
    <Box
      borderStyle="round"
      borderColor={ready ? "#9ece6a" : "#565f89"}
      width="100%"
      paddingX={1}
      justifyContent="space-between"
    >
      <Text>
        {ready ? (
          <>
            <Text color="#9ece6a" bold>{"● "}</Text>
            <Text color="#c0caf5" bold>Connected</Text>
            <Text color="#565f89">{" to "}</Text>
            <Text color="#7aa2f7" bold>{shortId}</Text>
          </>
        ) : connected && handshakeState === "verifying" ? (
          <AnimatedSpinner label={`Verifying session ${shortId}...`} color="#e0af68" />
        ) : connected && handshakeState === "failed" ? (
          <>
            <Text color="#f7768e" bold>{"✗ "}</Text>
            <Text color="#f7768e">Handshake failed — please reconnect</Text>
          </>
        ) : reconnectCount > 0 ? (
          <>
            <Text color="#565f89">{"○ "}</Text>
            <AnimatedSpinner label={`Reconnecting (attempt ${reconnectCount})...`} color="#e0af68" />
          </>
        ) : (
          <>
            <Text color="#565f89">{"○ "}</Text>
            <AnimatedSpinner label="Connecting..." color="#7aa2f7" />
          </>
        )}
      </Text>
      <Text>
        <Text color="#565f89">{"│ "}</Text>
        <Text color={ruleCount > 0 ? "#e0af68" : "#565f89"}>
          {ruleCount} rule{ruleCount !== 1 ? "s" : ""}
        </Text>
        <Text color="#565f89">{" │ "}</Text>
        <Text dimColor>[p]</Text>
        <Text color="#565f89"> permissions</Text>
        <Text color="#565f89">{" │ "}</Text>
        <Text dimColor>[q]</Text>
        <Text color="#565f89"> quit</Text>
      </Text>
    </Box>
  );
}

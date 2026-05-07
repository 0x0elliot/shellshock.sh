import React from "react";
import { Box, Text } from "ink";
import type { ClientInfo } from "shellshock.sh-shared";

interface StatusBarProps {
  host: string;
  port: number;
  tunnelUrl?: string;
  clientConnected: boolean;
  handshakeComplete: boolean;
  clientInfo: ClientInfo | null;
}

export function StatusBar({ host, port, tunnelUrl, clientConnected, handshakeComplete, clientInfo }: StatusBarProps) {
  const url = tunnelUrl ?? `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`;

  let statusIcon: string;
  let statusColor: string;
  let statusLabel: string;
  if (clientConnected && handshakeComplete) {
    statusIcon = "●";
    statusColor = "#9ece6a";
    statusLabel = clientInfo
      ? `${clientInfo.username}@${clientInfo.hostname}`
      : "connected";
  } else if (clientConnected) {
    statusIcon = "◐";
    statusColor = "#e0af68";
    statusLabel = "handshaking";
  } else {
    statusIcon = "○";
    statusColor = "#565f89";
    statusLabel = "waiting";
  }

  return (
    <Box
      borderStyle="round"
      borderColor="#7aa2f7"
      width="100%"
      paddingX={1}
    >
      <Text wrap="truncate">
        <Text color="#7aa2f7" bold>{"⟡ "}</Text>
        <Text color="#c0caf5" bold>shellshock.sh</Text>
        <Text dimColor>{" │ "}</Text>
        <Text color={tunnelUrl ? "#9ece6a" : "#e0af68"}>{url}</Text>
        {tunnelUrl && <Text color="#9ece6a" bold>{" ⇡ ngrok"}</Text>}
        <Text dimColor>{" │ "}</Text>
        <Text color={statusColor}>{statusIcon} {statusLabel}</Text>
        <Text dimColor>{" │ "}</Text>
        <Text dimColor>^S</Text><Text color="#bb9af7"> secrets</Text>
        <Text dimColor>{" │ "}</Text>
        <Text dimColor>^N</Text><Text color="#565f89"> reset</Text>
        <Text dimColor>{" │ "}</Text>
        <Text dimColor>^C</Text><Text color="#565f89"> quit</Text>
      </Text>
    </Box>
  );
}

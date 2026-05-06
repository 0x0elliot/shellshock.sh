import React from "react";
import { Box, Text } from "ink";
import type { ClientInfo } from "@remote-debugger/shared";
import { AnimatedSpinner } from "./animated-spinner.js";

export interface ActiveSessionInfo {
  id: string;
  label: string | null;
  clientInfo: ClientInfo | null;
  connected: boolean;
  handshakeComplete: boolean;
  commandCount: number;
}

interface SessionListProps {
  sessions: ActiveSessionInfo[];
  activeIndex: number;
  onSelect: (idx: number) => void;
}

export function SessionList({
  sessions,
  activeIndex,
}: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text color="#565f89">No sessions.</Text>
        <AnimatedSpinner label="Waiting..." color="#7aa2f7" />
        <Text dimColor>Press <Text color="#e0af68">Ctrl+N</Text> to create</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text color="#7aa2f7" bold>Sessions ({sessions.length})</Text>
      <Text>{" "}</Text>
      {sessions.map((session, idx) => {
        const isActive = idx === activeIndex;
        const prefix = isActive ? ">" : " ";
        const label = session.label ?? session.id.substring(0, 8);

        let statusIcon: string;
        let statusColor: string;
        if (session.connected && session.handshakeComplete) {
          statusIcon = "●";
          statusColor = "#9ece6a";
        } else if (session.connected) {
          statusIcon = "◐";
          statusColor = "#e0af68";
        } else {
          statusIcon = "○";
          statusColor = "#565f89";
        }

        const info = session.clientInfo
          ? ` ${session.clientInfo.username}@${session.clientInfo.hostname.substring(0, 12)}`
          : session.connected
            ? session.handshakeComplete ? "" : " handshaking..."
            : " waiting...";

        return (
          <Text key={session.id}>
            <Text color={isActive ? "#7aa2f7" : "#565f89"} bold>{prefix}</Text>
            <Text color={isActive ? "#c0caf5" : "#565f89"}>{idx + 1}</Text>
            <Text> </Text>
            <Text color={statusColor}>{statusIcon}</Text>
            <Text color={isActive ? "#c0caf5" : "#a9b1d6"} bold={isActive}> {label}</Text>
            <Text color="#565f89" dimColor>{info}</Text>
          </Text>
        );
      })}
    </Box>
  );
}

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
        <Text color="#565f89">No sessions yet.</Text>
        <Text color="#565f89">{" "}</Text>
        <AnimatedSpinner label="Waiting..." color="#7aa2f7" />
        <Text color="#565f89">{" "}</Text>
        <Text dimColor>Press <Text color="#e0af68">Ctrl+N</Text> to create one.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text color="#7aa2f7" bold>
        {"⟡ Sessions"}
      </Text>
      <Text>{" "}</Text>
      {sessions.map((session, idx) => {
        const isActive = idx === activeIndex;
        const prefix = isActive ? "›" : " ";

        const description = session.clientInfo
          ? `${session.clientInfo.username}@${session.clientInfo.hostname}`
          : "";

        const label = session.label ?? session.id.substring(0, 8);

        let statusIcon: React.ReactNode;
        if (session.connected && session.handshakeComplete) {
          statusIcon = <Text color="#9ece6a">{"● "}</Text>;
        } else if (session.connected) {
          statusIcon = <Text color="#e0af68">{"◐ "}</Text>;
        } else {
          statusIcon = <Text color="#565f89">{"○ "}</Text>;
        }

        return (
          <Box key={session.id} flexDirection="column">
            <Text>
              <Text color={isActive ? "#7aa2f7" : "#565f89"} bold>{prefix} </Text>
              <Text color={isActive ? "#c0caf5" : "#565f89"} bold={isActive}>
                [{idx + 1}]
              </Text>
              <Text> </Text>
              {statusIcon}
              <Text color={isActive ? "#c0caf5" : "#a9b1d6"} bold={isActive}>
                {label}
              </Text>
            </Text>
            {description && (
              <Text>
                <Text>{"     "}</Text>
                <Text color="#565f89">{description}</Text>
              </Text>
            )}
            {session.connected && !session.handshakeComplete && (
              <Text>
                <Text>{"     "}</Text>
                <Text color="#e0af68" italic>handshake in progress...</Text>
              </Text>
            )}
            {!session.connected && (
              <Text>
                <Text>{"     "}</Text>
                <Text color="#565f89" italic>waiting for client...</Text>
              </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

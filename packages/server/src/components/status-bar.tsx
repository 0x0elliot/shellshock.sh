import React from "react";
import { Box, Text } from "ink";

interface StatusBarProps {
  host: string;
  port: number;
  sessionCount: number;
}

export function StatusBar({ host, port, sessionCount }: StatusBarProps) {
  const url = `http://${host}:${port}`;

  return (
    <Box
      borderStyle="round"
      borderColor="#7aa2f7"
      width="100%"
      paddingX={1}
      justifyContent="space-between"
    >
      <Text>
        <Text color="#7aa2f7" bold>{"⟡ "}</Text>
        <Text color="#c0caf5" bold>Remote Debugger</Text>
      </Text>
      <Text>
        <Text dimColor>{"│ "}</Text>
        <Text color="#9ece6a">{url}</Text>
        <Text dimColor>{" │ "}</Text>
        <Text color={sessionCount > 0 ? "#e0af68" : "#565f89"}>
          {sessionCount} session{sessionCount !== 1 ? "s" : ""}
        </Text>
        <Text dimColor>{" │ "}</Text>
        <Text dimColor>[↑↓]</Text><Text color="#565f89"> switch</Text>
        <Text dimColor>{" │ "}</Text>
        <Text dimColor>Ctrl+N</Text><Text color="#565f89"> new</Text>
        <Text dimColor>{" │ "}</Text>
        <Text dimColor>Ctrl+D</Text><Text color="#565f89"> close</Text>
        <Text dimColor>{" │ "}</Text>
        <Text dimColor>Ctrl+C</Text><Text color="#565f89"> quit</Text>
      </Text>
    </Box>
  );
}

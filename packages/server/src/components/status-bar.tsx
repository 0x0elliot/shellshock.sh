import React from "react";
import { Box, Text } from "ink";

interface StatusBarProps {
  host: string;
  port: number;
  sessionCount: number;
  tunnelUrl?: string;
}

export function StatusBar({ host, port, sessionCount, tunnelUrl }: StatusBarProps) {
  const url = tunnelUrl ?? `http://${host}:${port}`;

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
        <Text color="#c0caf5" bold>shellshock.sh</Text>
      </Text>
      <Text>
        <Text dimColor>{"│ "}</Text>
        <Text color={tunnelUrl ? "#9ece6a" : "#e0af68"}>{url}</Text>
        {tunnelUrl && <Text color="#9ece6a" bold>{" ⇡"}</Text>}
        <Text dimColor>{" │ "}</Text>
        <Text color={sessionCount > 0 ? "#e0af68" : "#565f89"}>
          {sessionCount} session{sessionCount !== 1 ? "s" : ""}
        </Text>
        <Text dimColor>{" │ "}</Text>
        <Text dimColor>Ctrl+N</Text><Text color="#565f89"> new</Text>
        <Text dimColor>{" │ "}</Text>
        <Text dimColor>Ctrl+S</Text><Text color="#565f89"> share</Text>
        <Text dimColor>{" │ "}</Text>
        <Text dimColor>Ctrl+C</Text><Text color="#565f89"> quit</Text>
      </Text>
    </Box>
  );
}

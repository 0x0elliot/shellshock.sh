import React, { useMemo } from "react";
import { Box, Text } from "ink";
import {
  type CommandClassification,
  classificationColor,
} from "shellshock.sh-shared";
import { AnimatedSpinner } from "./animated-spinner.js";

export interface CommandEntry {
  id: string;
  command: string;
  status: "pending" | "approved" | "denied" | "running" | "completed" | "failed";
  output?: string;
  exitCode?: number | null;
  classification: CommandClassification;
  deniedReason?: string;
}

interface OutputStreamProps {
  commands: CommandEntry[];
  maxHeight: number;
}

const CommandBlock = React.memo(function CommandBlock({ entry, showOutput }: { entry: CommandEntry; showOutput: boolean }) {
  const tagColor = classificationColor(entry.classification);
  const outputLines = showOutput
    ? (entry.output?.split("\n").filter(Boolean).slice(-20) ?? [])
    : [];

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text color="#565f89">{"  $"}</Text>
        <Text bold color="#c0caf5">{entry.command}</Text>
        <Text color={tagColor}>[{entry.classification}]</Text>
        {entry.status === "pending" && (
          <AnimatedSpinner label="awaiting approval" color="#e0af68" />
        )}
        {(entry.status === "running" || entry.status === "approved") && (
          <AnimatedSpinner label="running" color="#7dcfff" />
        )}
        {entry.status === "completed" && (
          <Text color={entry.exitCode === 0 ? "#9ece6a" : "#f7768e"}>
            {"✓ "}exit {entry.exitCode}
          </Text>
        )}
        {entry.status === "failed" && (
          <Text color="#f7768e">
            {"✗ "}exit {entry.exitCode ?? "?"}
          </Text>
        )}
        {entry.status === "denied" && (
          <Text color="#f7768e">
            {"✗ denied"}{entry.deniedReason ? ` — ${entry.deniedReason}` : ""}
          </Text>
        )}
      </Box>

      {outputLines.length > 0 && (
        <Box flexDirection="column" marginLeft={4}>
          {outputLines.map((line, i) => (
            <Text key={i} color="#a9b1d6" wrap="truncate">
              {line}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}, (prev, next) => {
  return prev.entry.id === next.entry.id
    && prev.entry.status === next.entry.status
    && prev.entry.output === next.entry.output
    && prev.entry.exitCode === next.entry.exitCode
    && prev.showOutput === next.showOutput;
});

export function OutputStream({ commands, maxHeight }: OutputStreamProps) {
  const visible = useMemo(
    () => commands.slice(-maxHeight),
    [commands, maxHeight],
  );

  const showOutputIds = useMemo(
    () => new Set(visible.slice(-3).map((e) => e.id)),
    [visible],
  );

  if (commands.length === 0) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text>{" "}</Text>
        <AnimatedSpinner label="Waiting for commands..." color="#7aa2f7" />
        <Text>{" "}</Text>
        <Text color="#565f89">Type a command below to send to the customer for approval.</Text>
        <Text color="#565f89">Every command requires their explicit consent.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} overflowY="hidden">
      {visible.map((entry) => (
        <CommandBlock
          key={entry.id}
          entry={entry}
          showOutput={showOutputIds.has(entry.id)}
        />
      ))}
    </Box>
  );
}

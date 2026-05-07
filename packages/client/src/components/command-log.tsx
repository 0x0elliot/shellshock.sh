import React from "react";
import { Box, Text } from "ink";
import {
  type CommandClassification,
  classificationColor,
} from "shellshock.sh-shared";
import { AnimatedSpinner } from "./animated-spinner.js";

export interface CommandEntry {
  id: string;
  command: string;
  status:
    | "pending"
    | "approved"
    | "denied"
    | "running"
    | "completed"
    | "failed";
  classification: CommandClassification;
  exitCode?: number | null;
  output?: string;
  deniedReason?: string;
}

interface CommandLogProps {
  commands: CommandEntry[];
  maxHeight?: number;
}

function CommandRow({ entry }: { entry: CommandEntry }) {
  const tagColor = classificationColor(entry.classification);
  const outputLines = entry.output?.split("\n").filter(Boolean).slice(0, 3);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box gap={1}>
        <Text>{"  "}</Text>
        {entry.status === "completed" && (
          <Text color={entry.exitCode === 0 ? "#9ece6a" : "#f7768e"}>{"✓ "}</Text>
        )}
        {entry.status === "failed" && (
          <Text color="#f7768e">{"✗ "}</Text>
        )}
        {entry.status === "denied" && (
          <Text color="#f7768e">{"✗ "}</Text>
        )}
        {(entry.status === "running" || entry.status === "approved") && (
          <AnimatedSpinner color="#7dcfff" />
        )}
        {entry.status === "pending" && (
          <AnimatedSpinner color="#e0af68" />
        )}
        <Text bold color="#c0caf5">{entry.command}</Text>
        <Text color={tagColor}>[{entry.classification}]</Text>
        {entry.status === "completed" && (
          <Text color="#565f89">exit: {entry.exitCode ?? "?"}</Text>
        )}
        {entry.status === "denied" && (
          <Text color="#f7768e">denied</Text>
        )}
        {(entry.status === "running" || entry.status === "approved") && (
          <Text color="#7dcfff">running...</Text>
        )}
      </Box>
      {outputLines && outputLines.length > 0 && (
        <Box flexDirection="column" marginLeft={5}>
          {outputLines.map((line, i) => (
            <Text key={i} color="#a9b1d6" wrap="truncate">
              {line}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

export function CommandLog({ commands, maxHeight = 20 }: CommandLogProps) {
  const visible =
    commands.length > maxHeight
      ? commands.slice(commands.length - maxHeight)
      : commands;

  if (commands.length === 0) {
    return (
      <Box paddingX={2} paddingY={1} flexDirection="column">
        <Text>{" "}</Text>
        <AnimatedSpinner label="Waiting for commands from engineer..." color="#7aa2f7" />
        <Text>{" "}</Text>
        <Text color="#565f89">Commands will appear here for your approval.</Text>
        <Text color="#565f89">Nothing runs without your explicit consent.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {visible.map((entry) => (
        <CommandRow key={entry.id} entry={entry} />
      ))}
    </Box>
  );
}

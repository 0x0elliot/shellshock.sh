import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

export type InteractiveChoiceResult = "client" | "engineer" | "deny";

interface InteractiveChoiceProps {
  command: string;
  commandId: string;
  onChoice: (choice: InteractiveChoiceResult) => void;
}

const OPTIONS: { label: string; hint: string; value: InteractiveChoiceResult }[] = [
  { label: "I'll interact myself", hint: "You control the terminal", value: "client" },
  { label: "Let engineer interact", hint: "Engineer controls, you watch", value: "engineer" },
  { label: "Deny", hint: "Don't run this command", value: "deny" },
];

export function InteractiveChoice({ command, onChoice }: InteractiveChoiceProps) {
  const [selected, setSelected] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) setSelected((prev) => Math.max(0, prev - 1));
    if (key.downArrow) setSelected((prev) => Math.min(OPTIONS.length - 1, prev + 1));
    if (key.return) onChoice(OPTIONS[selected].value);
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} borderStyle="round" borderColor="#ff9e64">
      <Box gap={1}>
        <Text color="#ff9e64" bold>INTERACTIVE</Text>
        <Text color="#c0caf5" bold>{command}</Text>
      </Box>
      <Text> </Text>
      <Text color="#a9b1d6">How would you like to handle this?</Text>
      <Text> </Text>
      {OPTIONS.map((opt, i) => (
        <Box key={opt.value} gap={1}>
          <Text color={i === selected ? "#7aa2f7" : "#565f89"}>
            {i === selected ? " ❯ " : "   "}
          </Text>
          <Text color={i === selected ? "#c0caf5" : "#565f89"} bold={i === selected}>
            {opt.label}
          </Text>
          <Text color="#565f89" dimColor> — {opt.hint}</Text>
        </Box>
      ))}
    </Box>
  );
}

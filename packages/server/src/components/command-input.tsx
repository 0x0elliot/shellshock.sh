import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { AnimatedSpinner } from "./animated-spinner.js";

interface CommandInputProps {
  sessionId: string;
  onSubmit: (command: string) => void;
  disabled: boolean;
  disabledReason?: string;
}

export function CommandInput({
  sessionId,
  onSubmit,
  disabled,
  disabledReason,
}: CommandInputProps) {
  const [value, setValue] = useState("");

  function handleSubmit(input: string) {
    const trimmed = input.trim();
    if (!trimmed) return;

    onSubmit(trimmed);
    setValue("");
  }

  if (disabled) {
    return (
      <Box paddingX={1} paddingY={0}>
        <AnimatedSpinner
          label={disabledReason ?? "Select or create a session to start"}
          color="#565f89"
        />
      </Box>
    );
  }

  return (
    <Box paddingX={1} paddingY={0}>
      <Text color="#7aa2f7" bold>{sessionId.substring(0, 8)}</Text>
      <Text color="#7aa2f7">{" › "}</Text>
      <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} />
    </Box>
  );
}

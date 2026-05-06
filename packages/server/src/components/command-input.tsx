import React, { useState, useRef } from "react";
import { Box, Text, useInput } from "ink";
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
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const savedInputRef = useRef("");

  useInput((_input, key) => {
    if (disabled) return;

    if (key.upArrow) {
      const history = historyRef.current;
      if (history.length === 0) return;

      if (historyIndexRef.current === -1) {
        savedInputRef.current = value;
      }

      const nextIdx = Math.min(historyIndexRef.current + 1, history.length - 1);
      historyIndexRef.current = nextIdx;
      setValue(history[history.length - 1 - nextIdx]);
      return;
    }

    if (key.downArrow) {
      if (historyIndexRef.current <= 0) {
        historyIndexRef.current = -1;
        setValue(savedInputRef.current);
        return;
      }

      historyIndexRef.current -= 1;
      const history = historyRef.current;
      setValue(history[history.length - 1 - historyIndexRef.current]);
      return;
    }
  });

  function handleSubmit(input: string) {
    const trimmed = input.trim();
    if (!trimmed) return;

    historyRef.current.push(trimmed);
    historyIndexRef.current = -1;
    savedInputRef.current = "";

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

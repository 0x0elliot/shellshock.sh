import React, { useState, useRef } from "react";
import { Box, Text, useInput } from "ink";
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
  const [cursor, setCursor] = useState(0);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const savedInputRef = useRef("");

  useInput((input, key) => {
    if (disabled) return;

    // Submit
    if (key.return) {
      const trimmed = value.trim();
      if (!trimmed) return;
      historyRef.current.push(trimmed);
      historyIndexRef.current = -1;
      savedInputRef.current = "";
      onSubmit(trimmed);
      setValue("");
      setCursor(0);
      return;
    }

    // History navigation
    if (key.upArrow) {
      const history = historyRef.current;
      if (history.length === 0) return;
      if (historyIndexRef.current === -1) {
        savedInputRef.current = value;
      }
      const nextIdx = Math.min(historyIndexRef.current + 1, history.length - 1);
      historyIndexRef.current = nextIdx;
      const cmd = history[history.length - 1 - nextIdx];
      setValue(cmd);
      setCursor(cmd.length);
      return;
    }

    if (key.downArrow) {
      if (historyIndexRef.current <= 0) {
        historyIndexRef.current = -1;
        setValue(savedInputRef.current);
        setCursor(savedInputRef.current.length);
        return;
      }
      historyIndexRef.current -= 1;
      const history = historyRef.current;
      const cmd = history[history.length - 1 - historyIndexRef.current];
      setValue(cmd);
      setCursor(cmd.length);
      return;
    }

    // Cursor movement
    if (key.leftArrow) {
      if (key.meta || key.ctrl) {
        setCursor(wordBoundaryLeft(value, cursor));
      } else {
        setCursor(Math.max(0, cursor - 1));
      }
      return;
    }

    if (key.rightArrow) {
      if (key.meta || key.ctrl) {
        setCursor(wordBoundaryRight(value, cursor));
      } else {
        setCursor(Math.min(value.length, cursor + 1));
      }
      return;
    }

    // Home / End
    if (input === "a" && key.ctrl) {
      setCursor(0);
      return;
    }
    if (input === "e" && key.ctrl) {
      setCursor(value.length);
      return;
    }

    // Delete
    if (key.backspace || key.delete) {
      if (cursor === 0) return;
      if (key.meta) {
        // Alt+Backspace: delete word
        const to = wordBoundaryLeft(value, cursor);
        setValue(value.slice(0, to) + value.slice(cursor));
        setCursor(to);
      } else {
        setValue(value.slice(0, cursor - 1) + value.slice(cursor));
        setCursor(cursor - 1);
      }
      return;
    }

    // Ctrl+W: delete word (unix convention)
    if (input === "w" && key.ctrl) {
      const to = wordBoundaryLeft(value, cursor);
      setValue(value.slice(0, to) + value.slice(cursor));
      setCursor(to);
      return;
    }

    // Ctrl+U: delete to start of line
    if (input === "u" && key.ctrl) {
      setValue(value.slice(cursor));
      setCursor(0);
      return;
    }

    // Ctrl+K: delete to end of line
    if (input === "k" && key.ctrl) {
      setValue(value.slice(0, cursor));
      return;
    }

    // Regular character input
    if (input && !key.ctrl && !key.meta) {
      setValue(value.slice(0, cursor) + input + value.slice(cursor));
      setCursor(cursor + input.length);
    }
  });

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

  const before = value.slice(0, cursor);
  const cursorChar = value[cursor] ?? " ";
  const after = value.slice(cursor + 1);

  return (
    <Box paddingX={1} paddingY={0}>
      <Text color="#7aa2f7" bold>{sessionId.substring(0, 8)}</Text>
      <Text color="#7aa2f7">{" > "}</Text>
      <Text>{before}</Text>
      <Text inverse>{cursorChar}</Text>
      <Text>{after}</Text>
    </Box>
  );
}

function wordBoundaryLeft(text: string, pos: number): number {
  let i = pos - 1;
  while (i > 0 && text[i - 1] === " ") i--;
  while (i > 0 && text[i - 1] !== " ") i--;
  return Math.max(0, i);
}

function wordBoundaryRight(text: string, pos: number): number {
  let i = pos;
  while (i < text.length && text[i] === " ") i++;
  while (i < text.length && text[i] !== " ") i++;
  return i;
}

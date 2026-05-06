import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import {
  type CommandClassification,
  CommandClassification as CC,
  classificationColor,
} from "@remote-debugger/shared";
import { AnimatedSpinner } from "./animated-spinner.js";

interface PermissionPromptProps {
  command: string;
  commandId: string;
  classification: CommandClassification;
  suggestedRule: string | null;
  isCompound: boolean;
  onAllow: (id: string) => void;
  onDeny: (id: string, reason?: string) => void;
  onAllowPattern: (id: string, rule: string) => void;
}

interface Option {
  key: string;
  label: string;
  description: string;
  color: string;
  action: () => void;
}

function describeAllowAll(command: string): string {
  const base = command.trim().split(/\s+/)[0] ?? command;
  const clean = base.includes("/") ? base.split("/").pop()! : base;
  return `Allow all \`${clean}\` commands`;
}

export function PermissionPrompt({
  command,
  commandId,
  classification,
  suggestedRule,
  isCompound,
  onAllow,
  onDeny,
  onAllowPattern,
}: PermissionPromptProps) {
  const borderColor = classificationColor(classification);
  const isInteractive = classification === CC.Interactive;
  const isDangerous = classification === CC.Destructive || classification === CC.Network;
  const canAutoAllow = !isCompound && !isInteractive && !!suggestedRule;

  const options = useMemo<Option[]>(() => {
    const opts: Option[] = [
      { key: "y", label: "Yes", description: "Allow this command", color: "#9ece6a", action: () => onAllow(commandId) },
    ];
    if (canAutoAllow) {
      opts.push({
        key: "a",
        label: "Yes, don't ask again",
        description: describeAllowAll(command),
        color: "#7aa2f7",
        action: () => onAllowPattern(commandId, suggestedRule!),
      });
    }
    opts.push({ key: "n", label: "No", description: "Deny this command", color: "#f7768e", action: () => onDeny(commandId) });
    return opts;
  }, [commandId, command, canAutoAllow, suggestedRule, onAllow, onDeny, onAllowPattern]);

  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : options.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex((prev) => (prev < options.length - 1 ? prev + 1 : 0));
    } else if (key.return) {
      options[selectedIndex].action();
    } else {
      const match = options.findIndex((o) => o.key === _input.toLowerCase());
      if (match !== -1) options[match].action();
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box
        borderStyle="round"
        borderColor={borderColor}
        flexDirection="column"
        paddingX={2}
        paddingY={1}
        width="100%"
      >
        <Box gap={1}>
          <AnimatedSpinner color={borderColor} />
          <Text color="#c0caf5" bold>Allow bash command:</Text>
          <Text bold color="#c0caf5">{command}</Text>
        </Box>

        {isCompound && (
          <>
            <Text>{" "}</Text>
            <Text color="#f7768e" bold>
              {"  ⚠ Compound command — pipes, chains, or redirects detected"}
            </Text>
            <Text color="#f7768e">
              {"    Review the full command carefully before approving."}
            </Text>
          </>
        )}

        {isInteractive && (
          <>
            <Text>{" "}</Text>
            <Text color="#ff9e64" bold>
              {"  ⚠ INTERACTIVE MODE — Full terminal access"}
            </Text>
            <Text color="#ff9e64">
              {"    This hands your terminal to the engineer's command."}
            </Text>
            <Text color="#ff9e64">
              {"    You will have full control — exit with :q, Ctrl+C, etc."}
            </Text>
            <Text color="#ff9e64">
              {"    All keystrokes and screen output are visible to the engineer."}
            </Text>
          </>
        )}

        {isDangerous && !isCompound && !isInteractive && (
          <>
            <Text>{" "}</Text>
            <Text color="#e0af68">
              {"  ⚠ This command may modify or access sensitive resources."}
            </Text>
          </>
        )}
      </Box>

      <Box flexDirection="column" paddingX={2} paddingTop={1}>
        {options.map((opt, i) => {
          const selected = i === selectedIndex;
          return (
            <Box key={opt.key} gap={1}>
              <Text color={selected ? opt.color : "#565f89"} bold={selected}>
                {selected ? "❯" : " "}
              </Text>
              <Text color={selected ? opt.color : "#565f89"} bold={selected}>
                {opt.label}
              </Text>
              {selected && (
                <Text color="#565f89">{"— "}{opt.description}</Text>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

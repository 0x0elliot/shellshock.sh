import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import {
  type SegmentEvaluation,
  classificationColor,
  suggestRule,
} from "shellshock.sh-shared";
import { AnimatedSpinner } from "./animated-spinner.js";

interface CompoundPermissionPromptProps {
  originalCommand: string;
  commandId: string;
  promptSegments: SegmentEvaluation[];
  totalSegments: number;
  onAllApproved: (id: string) => void;
  onDeny: (id: string, reason: string) => void;
  onAllowPattern: (id: string, rule: string) => void;
}

interface Option {
  key: string;
  label: string;
  description: string;
  color: string;
  action: () => void;
}

export function CompoundPermissionPrompt({
  originalCommand,
  commandId,
  promptSegments,
  totalSegments,
  onAllApproved,
  onDeny,
  onAllowPattern,
}: CompoundPermissionPromptProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState(0);

  const current = promptSegments[currentIndex];
  if (!current) return null;

  const borderColor = classificationColor(current.classification);
  const suggested = suggestRule(current.segment.command);

  const options = useMemo<Option[]>(() => {
    const opts: Option[] = [
      {
        key: "y",
        label: "Yes",
        description: "Allow this command",
        color: "#9ece6a",
        action: () => {
          if (currentIndex < promptSegments.length - 1) {
            setCurrentIndex((prev) => prev + 1);
            setSelectedOption(0);
          } else {
            onAllApproved(commandId);
          }
        },
      },
    ];

    if (suggested) {
      const base = current.segment.command.trim().split(/\s+/)[0] ?? "";
      const clean = base.includes("/") ? base.split("/").pop()! : base;
      opts.push({
        key: "a",
        label: "Yes, don't ask again",
        description: `Allow all \`${clean}\` commands`,
        color: "#7aa2f7",
        action: () => {
          onAllowPattern(commandId, suggested);
          if (currentIndex < promptSegments.length - 1) {
            setCurrentIndex((prev) => prev + 1);
            setSelectedOption(0);
          } else {
            onAllApproved(commandId);
          }
        },
      });
    }

    opts.push({
      key: "n",
      label: "No",
      description: "Deny the entire command",
      color: "#f7768e",
      action: () => onDeny(commandId, `Denied: ${current.segment.command}`),
    });

    return opts;
  }, [commandId, currentIndex, promptSegments.length, current, suggested, onAllApproved, onDeny, onAllowPattern]);

  useInput((_input, key) => {
    if (key.upArrow) {
      setSelectedOption((prev) => (prev > 0 ? prev - 1 : options.length - 1));
    } else if (key.downArrow) {
      setSelectedOption((prev) => (prev < options.length - 1 ? prev + 1 : 0));
    } else if (key.return) {
      options[selectedOption].action();
    } else {
      const match = options.findIndex((o) => o.key === _input.toLowerCase());
      if (match !== -1) options[match].action();
    }
  });

  const promptNum = currentIndex + 1;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box paddingX={2} paddingBottom={1}>
        <Text color="#565f89">Full command: </Text>
        <Text color="#565f89" dimColor>{originalCommand}</Text>
      </Box>

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
          <Text color="#c0caf5" bold>
            Part {promptNum} of {promptSegments.length} ({totalSegments} in command):
          </Text>
        </Box>

        <Text>{" "}</Text>

        <Box paddingLeft={2}>
          <Text color={borderColor} bold>{current.segment.command}</Text>
        </Box>

        {current.segment.operator !== "none" && (
          <Box paddingLeft={2}>
            <Text color="#565f89" dimColor>
              connected by: {current.segment.operator}
            </Text>
          </Box>
        )}
      </Box>

      <Box flexDirection="column" paddingX={2} paddingTop={1}>
        {options.map((opt, i) => {
          const selected = i === selectedOption;
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

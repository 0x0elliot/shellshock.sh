import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import {
  type GroupEvaluation,
  classifyCommand,
  classificationColor,
  suggestRule,
} from "@remote-debugger/shared";
import { AnimatedSpinner } from "./animated-spinner.js";

interface CompoundPermissionPromptProps {
  originalCommand: string;
  commandId: string;
  promptGroups: GroupEvaluation[];
  totalGroups: number;
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
  promptGroups,
  totalGroups,
  onAllApproved,
  onDeny,
  onAllowPattern,
}: CompoundPermissionPromptProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState(0);

  const current = promptGroups[currentIndex];
  if (!current) return null;

  const group = current.group;
  const borderColor = classificationColor(group.classification);
  const suggested = !group.isPipeline ? suggestRule(group.fullText) : null;

  const options = useMemo<Option[]>(() => {
    const opts: Option[] = [
      {
        key: "y",
        label: "Yes",
        description: `Allow this ${group.isPipeline ? "pipeline" : "command"}`,
        color: "#9ece6a",
        action: () => {
          if (currentIndex < promptGroups.length - 1) {
            setCurrentIndex((prev) => prev + 1);
            setSelectedOption(0);
          } else {
            onAllApproved(commandId);
          }
        },
      },
    ];

    if (suggested) {
      opts.push({
        key: "a",
        label: "Yes, don't ask again",
        description: `Allow all \`${group.fullText.trim().split(/\s+/)[0]}\` commands`,
        color: "#7aa2f7",
        action: () => {
          onAllowPattern(commandId, suggested);
          if (currentIndex < promptGroups.length - 1) {
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
      action: () => onDeny(commandId, `Denied at part: ${group.fullText}`),
    });

    return opts;
  }, [commandId, currentIndex, promptGroups.length, group, suggested, onAllApproved, onDeny, onAllowPattern]);

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

  const groupNumber = currentIndex + 1;
  const totalPrompts = promptGroups.length;

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Full command context */}
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
            Reviewing part {groupNumber}/{totalPrompts} ({totalGroups} total in command):
          </Text>
        </Box>

        <Text>{" "}</Text>

        {group.isPipeline ? (
          <Box flexDirection="column" paddingLeft={2}>
            {group.segments.map((seg, i) => {
              const segColor = classificationColor(classifyCommand(seg.command));
              return (
                <Box key={i} gap={1}>
                  {i > 0 && <Text color="#565f89">| </Text>}
                  <Text color={segColor} bold>{seg.command}</Text>
                </Box>
              );
            })}
            <Text>{" "}</Text>
            <Text color="#e0af68">
              {"⚠ Pipeline — all stages run together"}
            </Text>
          </Box>
        ) : (
          <Box paddingLeft={2}>
            <Text color={borderColor} bold>{group.fullText}</Text>
          </Box>
        )}
      </Box>

      {/* Options */}
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

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { PermissionRule } from "shellshock.sh-shared";

interface AllowlistViewProps {
  allowRules: PermissionRule[];
  denyRules: PermissionRule[];
  onDelete: (raw: string) => void;
  onClose: () => void;
}

export function AllowlistView({
  allowRules,
  denyRules,
  onDelete,
  onClose,
}: AllowlistViewProps) {
  const allItems = [
    ...allowRules.map((r) => ({ type: "allow" as const, rule: r })),
    ...denyRules.map((r) => ({ type: "deny" as const, rule: r })),
  ];

  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.escape || input === "p" || input === "P") {
      onClose();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(allItems.length - 1, prev + 1));
      return;
    }

    if (input === "x" || input === "X") {
      if (allItems.length > 0 && selectedIndex < allItems.length) {
        const item = allItems[selectedIndex];
        onDelete(item.rule.raw);
        if (selectedIndex >= allItems.length - 1 && selectedIndex > 0) {
          setSelectedIndex(selectedIndex - 1);
        }
      }
    }
  });

  return (
    <Box
      borderStyle="round"
      borderColor="#7aa2f7"
      flexDirection="column"
      paddingX={2}
      paddingY={1}
      width="100%"
      marginX={1}
    >
      <Text color="#7aa2f7" bold>
        {"⟡ Permission Rules"}
      </Text>
      <Text>{" "}</Text>

      {allowRules.length > 0 && (
        <>
          <Text color="#9ece6a" bold>
            {"  ALLOW:"}
          </Text>
          {allowRules.map((rule, i) => {
            const isSelected = i === selectedIndex;
            return (
              <Text key={`allow-${rule.raw}`}>
                {"  "}
                {isSelected ? (
                  <Text color="#7aa2f7" bold>{"› "}</Text>
                ) : (
                  <Text>{"  "}</Text>
                )}
                <Text color={isSelected ? "#7aa2f7" : "#a9b1d6"} bold={isSelected}>
                  {rule.raw}
                </Text>
              </Text>
            );
          })}
          <Text>{" "}</Text>
        </>
      )}

      {denyRules.length > 0 && (
        <>
          <Text color="#f7768e" bold>
            {"  DENY:"}
          </Text>
          {denyRules.map((rule, i) => {
            const globalIdx = allowRules.length + i;
            const isSelected = globalIdx === selectedIndex;
            return (
              <Text key={`deny-${rule.raw}`}>
                {"  "}
                {isSelected ? (
                  <Text color="#7aa2f7" bold>{"› "}</Text>
                ) : (
                  <Text>{"  "}</Text>
                )}
                <Text color={isSelected ? "#7aa2f7" : "#a9b1d6"} bold={isSelected}>
                  {rule.raw}
                </Text>
              </Text>
            );
          })}
          <Text>{" "}</Text>
        </>
      )}

      {allowRules.length === 0 && denyRules.length === 0 && (
        <>
          <Text color="#565f89">{"  No rules configured yet."}</Text>
          <Text color="#565f89">{"  Rules are created when you press [p] Allow Pattern."}</Text>
          <Text>{" "}</Text>
        </>
      )}

      <Text color="#565f89">
        {"  "}<Text dimColor>[↑↓]</Text> Navigate  <Text dimColor>[x]</Text> Delete  <Text dimColor>[Esc]</Text> Close
      </Text>
    </Box>
  );
}

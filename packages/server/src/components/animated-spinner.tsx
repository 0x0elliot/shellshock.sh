import React from "react";
import { Text } from "ink";
import { useSpinnerTick } from "./use-spinner-tick.js";

const SPINNER_FRAMES = ["✻", "✼", "✽", "✾", "✿", "❀", "❁", "❂", "❃", "❊"];
const COLORS = ["#7aa2f7", "#bb9af7", "#7dcfff", "#9ece6a", "#e0af68", "#f7768e"];

interface AnimatedSpinnerProps {
  label?: string;
  color?: string;
}

export const AnimatedSpinner = React.memo(function AnimatedSpinner({ label, color }: AnimatedSpinnerProps) {
  const frame = useSpinnerTick();
  const spinnerColor = color ?? COLORS[frame % COLORS.length];

  return (
    <Text>
      <Text color={spinnerColor} bold>{SPINNER_FRAMES[frame]}</Text>
      {label && <Text color={spinnerColor}> {label}</Text>}
    </Text>
  );
});

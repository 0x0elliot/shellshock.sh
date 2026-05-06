import React, { useState, useEffect } from "react";
import { Text } from "ink";

const SPINNER_FRAMES = ["✻", "✼", "✽", "✾", "✿", "❀", "❁", "❂", "❃", "❊"];
const COLORS = ["#7aa2f7", "#bb9af7", "#7dcfff", "#9ece6a", "#e0af68", "#f7768e"];

interface AnimatedSpinnerProps {
  label?: string;
  color?: string;
}

export function AnimatedSpinner({ label, color }: AnimatedSpinnerProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 120);
    return () => clearInterval(interval);
  }, []);

  const spinnerColor = color ?? COLORS[frame % COLORS.length];

  return (
    <Text>
      <Text color={spinnerColor} bold>{SPINNER_FRAMES[frame]}</Text>
      {label && <Text color={spinnerColor}> {label}</Text>}
    </Text>
  );
}

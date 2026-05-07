import { useSyncExternalStore } from "react";

let frame = 0;
const listeners = new Set<() => void>();
let interval: ReturnType<typeof setInterval> | null = null;

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!interval) {
    interval = setInterval(() => {
      frame = (frame + 1) % 10;
      for (const l of listeners) l();
    }, 120);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && interval) {
      clearInterval(interval);
      interval = null;
    }
  };
}

function getSnapshot() {
  return frame;
}

export function useSpinnerTick(): number {
  return useSyncExternalStore(subscribe, getSnapshot);
}

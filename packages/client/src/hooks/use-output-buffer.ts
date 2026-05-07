import { useRef, useEffect, useCallback } from "react";

interface BufferEntry {
  commandId: string;
  data: string;
}

export function useOutputBuffer(
  onFlush: (entries: Map<string, string>) => void,
  intervalMs = 80,
) {
  const bufferRef = useRef<BufferEntry[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onFlushRef = useRef(onFlush);
  onFlushRef.current = onFlush;

  useEffect(() => {
    timerRef.current = setInterval(() => {
      const buf = bufferRef.current;
      if (buf.length === 0) return;
      bufferRef.current = [];

      const merged = new Map<string, string>();
      for (const { commandId, data } of buf) {
        merged.set(commandId, (merged.get(commandId) ?? "") + data);
      }
      onFlushRef.current(merged);
    }, intervalMs);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);

      const buf = bufferRef.current;
      if (buf.length > 0) {
        bufferRef.current = [];
        const merged = new Map<string, string>();
        for (const { commandId, data } of buf) {
          merged.set(commandId, (merged.get(commandId) ?? "") + data);
        }
        onFlushRef.current(merged);
      }
    };
  }, [intervalMs]);

  const push = useCallback((commandId: string, data: string) => {
    bufferRef.current.push({ commandId, data });
  }, []);

  return push;
}

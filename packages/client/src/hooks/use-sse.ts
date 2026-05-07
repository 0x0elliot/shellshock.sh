import { useState, useEffect, useRef, useCallback } from "react";
import http from "node:http";
import https from "node:https";
import type { ServerToClientMessage, EncryptedEnvelope } from "shellshock.sh-shared";

export type RawSSEMessage = ServerToClientMessage | EncryptedEnvelope;

export function useSSE(url: string): {
  connected: boolean;
  messages: RawSSEMessage[];
  error: string | null;
  reconnectCount: number;
} {
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<RawSSEMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reconnectCount, setReconnectCount] = useState(0);

  const requestRef = useRef<http.ClientRequest | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const reconnectCountRef = useRef(0);

  const connectRef = useRef<() => void>();
  const scheduleReconnectRef = useRef<() => void>();

  scheduleReconnectRef.current = () => {
    if (!mountedRef.current) return;

    reconnectCountRef.current += 1;
    setReconnectCount(reconnectCountRef.current);

    if (reconnectCountRef.current > 10) {
      setError("Connection lost after 10 retries");
      return;
    }

    const delay = Math.min(
      1000 * Math.pow(2, reconnectCountRef.current - 1),
      30000
    );

    reconnectTimerRef.current = setTimeout(() => {
      if (mountedRef.current) {
        connectRef.current?.();
      }
    }, delay);
  };

  connectRef.current = () => {
    if (!mountedRef.current) return;

    const getter = url.startsWith("https") ? https.get : http.get;
    const req = getter(url, {
      headers: {
        Accept: "text/event-stream",
        "ngrok-skip-browser-warning": "1",
      },
    });

    requestRef.current = req;

    req.on("response", (res: http.IncomingMessage) => {
      if (!mountedRef.current) {
        res.destroy();
        return;
      }

      if (res.statusCode !== 200) {
        setError(`Server returned status ${res.statusCode}`);
        scheduleReconnectRef.current?.();
        return;
      }

      setConnected(true);
      setError(null);
      reconnectCountRef.current = 0;
      setReconnectCount(0);

      let buffer = "";

      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        if (!mountedRef.current) return;

        buffer += chunk;
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        const batch: RawSSEMessage[] = [];
        for (const part of parts) {
          const lines = part.split("\n");
          let data = "";

          for (const line of lines) {
            if (line.startsWith("data:")) {
              data += line.slice(5).trim();
            }
          }

          if (!data) continue;

          try {
            const msg = JSON.parse(data);
            if (msg.type === "heartbeat") continue;
            batch.push(msg as RawSSEMessage);
          } catch {
            // Ignore malformed JSON
          }
        }
        if (batch.length > 0) {
          setMessages((prev) => [...prev, ...batch]);
        }
      });

      res.on("end", () => {
        if (!mountedRef.current) return;
        setConnected(false);
        scheduleReconnectRef.current?.();
      });

      res.on("error", (err: Error) => {
        if (!mountedRef.current) return;
        setConnected(false);
        setError(err.message);
        scheduleReconnectRef.current?.();
      });
    });

    req.on("error", (err: Error) => {
      if (!mountedRef.current) return;
      setConnected(false);
      setError(err.message);
      scheduleReconnectRef.current?.();
    });
  };

  const connect = useCallback(() => {
    connectRef.current?.();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;

      if (requestRef.current) {
        requestRef.current.destroy();
        requestRef.current = null;
      }

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [connect]);

  return { connected, messages, error, reconnectCount };
}

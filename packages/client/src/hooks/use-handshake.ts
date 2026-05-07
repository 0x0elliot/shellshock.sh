import { useState, useEffect, useRef, useCallback } from "react";
import crypto from "node:crypto";
import os from "node:os";
import type { ServerToClientMessage, ClientToServerMessage } from "shellshock.sh-shared";

export type HandshakeState = "waiting" | "verifying" | "complete" | "failed";

interface UseHandshakeResult {
  state: HandshakeState;
  error: string | null;
}

export function useHandshake(
  messages: ServerToClientMessage[],
  serverBaseUrl: string,
  sessionId: string,
  token: string,
): UseHandshakeResult {
  const [state, setState] = useState<HandshakeState>("waiting");
  const [error, setError] = useState<string | null>(null);
  const challengeHandledRef = useRef(false);

  const post = useCallback(async (msg: ClientToServerMessage) => {
    const url = `${serverBaseUrl}/api/sessions/${sessionId}/respond?token=${token}`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg),
    });
  }, [serverBaseUrl, sessionId, token]);

  useEffect(() => {
    for (const msg of messages) {
      if (msg.type === "handshake_challenge" && !challengeHandledRef.current) {
        challengeHandledRef.current = true;
        setState("verifying");

        (async () => {
          try {
            const encrypted = crypto.publicEncrypt(
              { key: msg.publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
              Buffer.from(msg.nonce),
            ).toString("base64");

            await post({ type: "handshake_response", encryptedNonce: encrypted });
          } catch {
            setState("failed");
            setError("Failed to complete handshake — could not encrypt challenge");
          }
        })();
      }

      if (msg.type === "handshake_complete") {
        setState("complete");

        post({
          type: "client_info",
          hostname: os.hostname(),
          platform: process.platform,
          username: os.userInfo().username,
        }).catch(() => {});
      }

      if (msg.type === "handshake_error") {
        setState("failed");
        setError(msg.message);
        challengeHandledRef.current = false;
      }
    }
  }, [messages, post]);

  return { state, error };
}

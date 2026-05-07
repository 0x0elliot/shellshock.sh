import { useState, useEffect, useRef, useCallback } from "react";
import crypto from "node:crypto";
import os from "node:os";
import { encryptMessage } from "shellshock.sh-shared";
import type { ClientToServerMessage, EncryptedEnvelope } from "shellshock.sh-shared";
import type { RawSSEMessage } from "./use-sse.js";

export type HandshakeState = "waiting" | "verifying" | "complete" | "failed";

interface UseHandshakeResult {
  state: HandshakeState;
  sessionKey: Buffer | null;
  error: string | null;
}

export function useHandshake(
  messages: RawSSEMessage[],
  serverBaseUrl: string,
  sessionId: string,
  token: string,
): UseHandshakeResult {
  const [state, setState] = useState<HandshakeState>("waiting");
  const [error, setError] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState<Buffer | null>(null);
  const challengeHandledRef = useRef(false);
  const sessionKeyRef = useRef<Buffer | null>(null);

  const post = useCallback(async (msg: ClientToServerMessage | EncryptedEnvelope) => {
    const url = `${serverBaseUrl}/api/sessions/${sessionId}/respond?token=${token}`;
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "1",
      },
      body: JSON.stringify(msg),
    });
  }, [serverBaseUrl, sessionId, token]);

  useEffect(() => {
    for (const raw of messages) {
      if ("_enc" in raw) continue;
      const msg = raw;
      if (msg.type === "handshake_challenge" && !challengeHandledRef.current) {
        challengeHandledRef.current = true;
        setState("verifying");

        (async () => {
          try {
            const encryptedNonce = crypto.publicEncrypt(
              { key: msg.publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
              Buffer.from(msg.nonce),
            ).toString("base64");

            const aesKey = crypto.randomBytes(32);
            const encryptedSessionKey = crypto.publicEncrypt(
              { key: msg.publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
              aesKey,
            ).toString("base64");

            sessionKeyRef.current = aesKey;

            await post({ type: "handshake_response", encryptedNonce, encryptedSessionKey });
          } catch {
            setState("failed");
            setError("Failed to complete handshake — could not encrypt challenge");
          }
        })();
      }

      if (msg.type === "handshake_complete") {
        setSessionKey(sessionKeyRef.current);
        setState("complete");

        const infoMsg: ClientToServerMessage = {
          type: "client_info",
          hostname: os.hostname(),
          platform: process.platform,
          username: os.userInfo().username,
        };

        if (sessionKeyRef.current) {
          const envelope: EncryptedEnvelope = {
            _enc: encryptMessage(sessionKeyRef.current, JSON.stringify(infoMsg)),
          };
          post(envelope).catch(() => {});
        } else {
          post(infoMsg).catch(() => {});
        }
      }

      if (msg.type === "handshake_error") {
        setState("failed");
        setError(msg.message);
        challengeHandledRef.current = false;
      }
    }
  }, [messages, post]);

  return { state, sessionKey, error };
}

import { EventEmitter } from "node:events";
import { opensslEncrypt, generatePassword, generateAuthId } from "./crypto.js";

export interface SecretEntry {
  authId: string;
  decryptKey: string;
  blob: string;
  plaintextLength: number;
  expiresAt: number;
}

export class SecretStore extends EventEmitter {
  private secrets = new Map<string, SecretEntry>();

  create(plaintext: string, ttlMinutes = 15): SecretEntry {
    const authId = generateAuthId();
    const decryptKey = generatePassword();
    const blob = opensslEncrypt(plaintext, decryptKey);

    const entry: SecretEntry = {
      authId,
      decryptKey,
      blob,
      plaintextLength: plaintext.length,
      expiresAt: Date.now() + ttlMinutes * 60_000,
    };

    this.secrets.set(authId, entry);

    setTimeout(() => {
      if (this.secrets.has(authId)) {
        this.secrets.delete(authId);
        this.emit("expired", authId);
      }
    }, ttlMinutes * 60_000);

    return entry;
  }

  retrieve(authId: string, ip: string): string | null {
    const entry = this.secrets.get(authId);
    if (!entry) return null;

    if (entry.expiresAt < Date.now()) {
      this.secrets.delete(authId);
      this.emit("expired", authId);
      return null;
    }

    this.secrets.delete(authId);
    this.emit("retrieved", authId, ip);
    return entry.blob;
  }

  cancel(authId: string): void {
    this.secrets.delete(authId);
  }
}

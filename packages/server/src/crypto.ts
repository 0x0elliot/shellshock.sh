import crypto from "node:crypto";

function evpBytesToKey(
  password: Buffer,
  salt: Buffer
): { key: Buffer; iv: Buffer } {
  const chunks: Buffer[] = [];
  let prev = Buffer.alloc(0);
  while (Buffer.concat(chunks).length < 48) {
    prev = crypto
      .createHash("sha256")
      .update(Buffer.concat([prev, password, salt]))
      .digest();
    chunks.push(prev);
  }
  const derived = Buffer.concat(chunks).subarray(0, 48);
  return { key: derived.subarray(0, 32), iv: derived.subarray(32, 48) };
}

export function opensslEncrypt(plaintext: string, password: string): string {
  const salt = crypto.randomBytes(8);
  const { key, iv } = evpBytesToKey(Buffer.from(password, "utf8"), salt);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([Buffer.from("Salted__"), salt, encrypted]).toString(
    "base64"
  );
}

export function generatePassword(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function generateAuthId(): string {
  return crypto.randomBytes(16).toString("base64url");
}

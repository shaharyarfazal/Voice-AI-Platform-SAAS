import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// AES-256-GCM for secrets at rest (OAuth tokens, custom function and MCP credentials).
// ENCRYPTION_KEY is preferred; without it the key is derived from SESSION_SECRET, so changing
// SESSION_SECRET then makes stored secrets unreadable (integrations must be reconnected).
function key(): Buffer {
  const source = process.env.ENCRYPTION_KEY || `secrets:${process.env.SESSION_SECRET}`;
  return createHash("sha256").update(source).digest();
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decrypt(token: string): string {
  const [version, iv, tag, data] = token.split(".");
  if (version !== "v1" || !iv || !tag || data === undefined) throw new Error("Unreadable secret");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { sql } from "./db";

// API keys look like vk_<32 random bytes, base64url>. Only a SHA-256 hash is stored, so a key
// can't be shown again after it's created; the first 12 characters identify it in the list.

export function createApiKeySecret(): { key: string; prefix: string; hash: string } {
  const key = `vk_${randomBytes(32).toString("base64url")}`;
  return { key, prefix: key.slice(0, 12), hash: hashKey(key) };
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export type ApiCaller = { tenantId: string; keyId: string };

/** The workspace behind an `Authorization: Bearer vk_...` header, or null. */
export async function authenticateApiKey(request: Request): Promise<ApiCaller | null> {
  const header = request.headers.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!key.startsWith("vk_") || key.length > 100) return null;
  const [row] = await sql<{ id: string; tenant_id: string; status: string }[]>`
    SELECT k.id, k.tenant_id, t.status FROM api_keys k JOIN tenants t ON t.id = k.tenant_id
    WHERE k.key_hash = ${hashKey(key)} AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now())`;
  if (!row || row.status !== "active") return null;
  // At most one write a minute per key.
  void sql`UPDATE api_keys SET last_used_at = now() WHERE id = ${row.id} AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`.catch(() => {});
  return { tenantId: row.tenant_id, keyId: row.id };
}

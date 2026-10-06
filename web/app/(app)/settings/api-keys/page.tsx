import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { sql } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { revokeApiKey } from "../actions";
import { CreateKeyForm } from "./create-key";

export default async function ApiKeysPage() {
  const { tenantId } = await requireRole("admin");
  const keys = await sql<{ id: string; name: string; prefix: string; created_at: Date; expires_at: Date | null; last_used_at: Date | null; revoked_at: Date | null; creator: string | null; expired: boolean }[]>`
    SELECT k.id, k.name, k.prefix, k.created_at, k.expires_at, k.last_used_at, k.revoked_at, u.email AS creator,
      (k.expires_at IS NOT NULL AND k.expires_at < now()) AS expired
    FROM api_keys k LEFT JOIN users u ON u.id = k.created_by WHERE k.tenant_id = ${tenantId} ORDER BY k.created_at DESC`;

  return (
    <div className="space-y-8">
      <p className="text-sm text-muted">
        Use API keys to manage agents, start calls and read call data from your own code, n8n, Make or Zapier.{" "}
        <Link href="/docs" className="text-accent underline">Read the API docs</Link>.
      </p>
      <CreateKeyForm />
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Keys</h2>
        {keys.length === 0 ? (
          <p className="text-sm text-muted">No keys yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Name</th><th>Key</th><th>Status</th><th>Last used</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {keys.map((k) => {
                  const expired = k.expired;
                  const status = k.revoked_at ? "Revoked" : expired ? "Expired" : k.expires_at ? `Expires ${formatDateTime(k.expires_at)}` : "Never expires";
                  const active = !k.revoked_at && !expired;
                  return (
                    <tr key={k.id} className={active ? "" : "text-muted"}>
                      <td>
                        <div className="font-medium">{k.name}</div>
                        <div className="text-xs text-muted">Created {formatDateTime(k.created_at)}{k.creator ? ` by ${k.creator}` : ""}</div>
                      </td>
                      <td className="font-mono text-xs">{k.prefix}…</td>
                      <td className="text-sm">
                        {active ? <span className="text-good">●</span> : <span className="text-muted">○</span>} <span>{status}</span>
                      </td>
                      <td className="text-sm text-muted">{k.last_used_at ? formatDateTime(k.last_used_at) : "Never"}</td>
                      <td className="text-right">
                        {!k.revoked_at && (
                          <form action={revokeApiKey}>
                            <input type="hidden" name="id" value={k.id} />
                            <button className="text-sm text-muted underline hover:text-critical">Revoke</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

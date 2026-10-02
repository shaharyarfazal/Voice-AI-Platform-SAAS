import Link from "next/link";
import { latencyLabel } from "@/components/latency";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { formatDateTime, formatDuration, formatMoney } from "@/lib/format";
import { callCostSql, getSettings } from "@/lib/settings";
import { isUuid } from "@/lib/validation";

const PAGE_SIZE = 100;

export default async function AdminCallsPage({ searchParams }: PageProps<"/admin/calls">) {
  await requireAdmin();
  const sp = await searchParams;
  const tenant = typeof sp.tenant === "string" && isUuid(sp.tenant) ? sp.tenant : null;
  const outcome = typeof sp.outcome === "string" && sp.outcome ? sp.outcome : null;
  const page = Math.max(1, Number(sp.page) || 1);
  const { rates } = await getSettings();

  const [tenants, calls] = await Promise.all([
    sql`SELECT id, name FROM tenants ORDER BY name`,
    sql`
      SELECT c.id, c.started_at, c.channel, c.from_number, c.duration_seconds, c.outcome, c.latency,
             t.name AS tenant_name, a.name AS agent_name, (${callCostSql(rates)})::float AS cost
      FROM calls c JOIN tenants t ON t.id = c.tenant_id LEFT JOIN agents a ON a.id = c.agent_id
      WHERE (${tenant}::uuid IS NULL OR c.tenant_id = ${tenant})
        AND (${outcome}::text IS NULL OR c.outcome = ${outcome})
      ORDER BY c.started_at DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${(page - 1) * PAGE_SIZE}`,
  ]);
  const hasMore = calls.length > PAGE_SIZE;
  const qs = (p: number) => `?${new URLSearchParams({ ...(tenant ? { tenant } : {}), ...(outcome ? { outcome } : {}), page: String(p) })}`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">All calls</h1>
      <form className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="tenant">Client</label>
          <select className="input" id="tenant" name="tenant" defaultValue={tenant ?? ""}>
            <option value="">All clients</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="outcome">Outcome</label>
          <select className="input" id="outcome" name="outcome" defaultValue={outcome ?? ""}>
            <option value="">Any</option>
            <option value="completed">Completed</option>
            <option value="caller_hung_up">Caller hung up</option>
            <option value="transferred">Transferred</option>
            <option value="error">Error</option>
          </select>
        </div>
        <button className="btn-secondary">Filter</button>
      </form>
      {calls.length === 0 ? (
        <p className="text-sm text-muted">No calls match.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr><th className="pl-4">When</th><th>Client</th><th>Agent</th><th>Channel</th><th>From</th><th>Duration</th><th>Outcome</th><th>Response</th><th>Est. cost</th></tr>
            </thead>
            <tbody>
              {calls.slice(0, PAGE_SIZE).map((c) => (
                <tr key={c.id}>
                  <td className="pl-4"><Link className="underline" href={`/admin/calls/${c.id}`}>{formatDateTime(c.started_at)}</Link></td>
                  <td>{c.tenant_name}</td>
                  <td>{c.agent_name ?? "—"}</td>
                  <td>{c.channel}</td>
                  <td>{c.from_number ?? "—"}</td>
                  <td className="tabular-nums">{formatDuration(c.duration_seconds)}</td>
                  <td>{c.outcome.replaceAll("_", " ")}</td>
                  <td className="tabular-nums">{latencyLabel(c.latency)}</td>
                  <td className="tabular-nums">{formatMoney(c.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex gap-3 text-sm">
        {page > 1 && <Link className="underline" href={qs(page - 1)}>← Newer</Link>}
        {hasMore && <Link className="underline" href={qs(page + 1)}>Older →</Link>}
      </div>
    </div>
  );
}

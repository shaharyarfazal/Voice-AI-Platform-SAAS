import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { sql, type CallRow } from "@/lib/db";
import { CallTable } from "./calls/call-table";

export default async function DashboardPage() {
  const { tenantId } = await requireSession();

  const [stats] = await sql`
    SELECT
      (SELECT count(*)::int FROM agents WHERE tenant_id = ${tenantId}) AS agents,
      (SELECT count(*)::int FROM phone_numbers WHERE tenant_id = ${tenantId}) AS numbers,
      count(*)::int AS calls,
      coalesce(sum(duration_seconds), 0)::int AS seconds
    FROM calls
    WHERE tenant_id = ${tenantId} AND started_at >= date_trunc('month', now())`;

  const recent = await sql<CallRow[]>`
    SELECT c.*, a.name AS agent_name FROM calls c LEFT JOIN agents a ON a.id = c.agent_id
    WHERE c.tenant_id = ${tenantId} ORDER BY c.started_at DESC LIMIT 10`;

  const tiles = [
    { label: "Agents", value: stats.agents },
    { label: "Phone numbers", value: stats.numbers },
    { label: "Calls this month", value: stats.calls },
    { label: "Minutes this month", value: Math.ceil(stats.seconds / 60) },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Overview</h1>
        <Link className="btn" href="/agents/new">New agent</Link>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="card">
            <div className="text-sm text-muted">{t.label}</div>
            <div className="mt-1 text-2xl font-semibold">{t.value}</div>
          </div>
        ))}
      </div>
      <section>
        <h2 className="mb-3 text-lg font-semibold">Recent calls</h2>
        <CallTable calls={recent} />
      </section>
    </div>
  );
}

import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { callCostSql, getSettings } from "@/lib/settings";
import { Status } from "../status";
import { NewClientForm } from "./forms";

export default async function TenantsPage() {
  await requireAdmin();
  const { rates } = await getSettings();
  const tenants = await sql`
    SELECT t.id, t.name, t.status, t.monthly_fee::float, t.price_per_minute::float, t.monthly_minute_limit, t.created_at,
      (SELECT count(*)::int FROM users u WHERE u.tenant_id = t.id) AS users,
      (SELECT count(*)::int FROM agents a WHERE a.tenant_id = t.id) AS agents,
      (SELECT count(*)::int FROM phone_numbers p WHERE p.tenant_id = t.id) AS numbers,
      coalesce(m.seconds, 0)::int AS seconds, coalesce(m.cost, 0)::float AS cost
    FROM tenants t
    LEFT JOIN LATERAL (
      SELECT sum(c.duration_seconds) AS seconds, sum(${callCostSql(rates)}) AS cost
      FROM calls c WHERE c.tenant_id = t.id AND c.started_at >= date_trunc('month', now())
    ) m ON true
    ORDER BY t.created_at DESC`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Clients</h1>
      <NewClientForm />
      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th className="pl-4">Client</th><th>Status</th><th>Users</th><th>Agents</th><th>Numbers</th>
              <th>Minutes (month)</th><th>Revenue (month)</th><th>Cost (month)</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => {
              const minutes = t.seconds / 60;
              const revenue = t.monthly_fee + minutes * t.price_per_minute;
              return (
                <tr key={t.id}>
                  <td className="pl-4"><Link className="underline" href={`/admin/tenants/${t.id}`}>{t.name}</Link></td>
                  <td><Status ok={t.status === "active"} label={t.status === "active" ? "Active" : "Suspended"} /></td>
                  <td>{t.users}</td>
                  <td>{t.agents}</td>
                  <td>{t.numbers}</td>
                  <td className="tabular-nums">
                    {Math.round(minutes)}
                    {t.monthly_minute_limit !== null && <span className="text-muted"> / {t.monthly_minute_limit}</span>}
                  </td>
                  <td className="tabular-nums">{formatMoney(revenue)}</td>
                  <td className="tabular-nums">{formatMoney(t.cost)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

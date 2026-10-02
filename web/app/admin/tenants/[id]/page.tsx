import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { formatDateTime, formatDuration } from "@/lib/format";
import { isUuid } from "@/lib/validation";
import { deleteClient } from "../actions";
import { ClientSettingsForm, type ClientFormValues } from "../forms";

export default async function TenantPage({ params, searchParams }: PageProps<"/admin/tenants/[id]">) {
  const admin = await requireAdmin();
  const { id } = await params;
  const deleteMismatch = (await searchParams).delete === "mismatch";
  if (!isUuid(id)) notFound();

  const [tenant] = await sql<(ClientFormValues & { created_at: Date })[]>`
    SELECT id, name, status, price_per_minute::text, monthly_fee::text, monthly_minute_limit,
           transcript_retention_days, notes, created_at
    FROM tenants WHERE id = ${id}`;
  if (!tenant) notFound();

  const [users, agents, numbers, calls] = await Promise.all([
    sql`SELECT id, email, is_platform_admin, last_login_at, created_at FROM users WHERE tenant_id = ${id} ORDER BY created_at`,
    sql`SELECT id, name, llm_model, updated_at FROM agents WHERE tenant_id = ${id} ORDER BY created_at`,
    sql`SELECT p.e164, p.carrier, a.name AS agent_name FROM phone_numbers p LEFT JOIN agents a ON a.id = p.agent_id
        WHERE p.tenant_id = ${id} ORDER BY p.created_at`,
    sql`SELECT c.id, c.started_at, c.channel, c.duration_seconds, c.outcome, a.name AS agent_name
        FROM calls c LEFT JOIN agents a ON a.id = c.agent_id WHERE c.tenant_id = ${id} ORDER BY c.started_at DESC LIMIT 20`,
  ]);

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin/tenants" className="text-sm text-muted underline">← Clients</Link>
        <h1 className="mt-2 text-2xl font-semibold">{tenant.name}</h1>
        <p className="text-sm text-muted">Client since {formatDateTime(tenant.created_at)}</p>
      </div>

      <ClientSettingsForm client={tenant} />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card">
          <h2 className="mb-2 font-medium">Users</h2>
          <ul className="space-y-1 text-sm">
            {users.map((u) => (
              <li key={u.id}>
                {u.email} {u.is_platform_admin && <span className="text-xs text-muted">(admin)</span>}
                <div className="text-xs text-muted">
                  {u.last_login_at ? `Last login ${formatDateTime(u.last_login_at)}` : "Never logged in"}
                </div>
              </li>
            ))}
          </ul>
          <Link href="/admin/users" className="mt-2 inline-block text-xs underline">Manage users</Link>
        </section>
        <section className="card">
          <h2 className="mb-2 font-medium">Agents</h2>
          {agents.length === 0 && <p className="text-sm text-muted">None yet.</p>}
          <ul className="space-y-1 text-sm">
            {agents.map((a) => <li key={a.id}>{a.name} <span className="text-xs text-muted">{a.llm_model}</span></li>)}
          </ul>
        </section>
        <section className="card">
          <h2 className="mb-2 font-medium">Phone numbers</h2>
          {numbers.length === 0 && <p className="text-sm text-muted">None yet.</p>}
          <ul className="space-y-1 text-sm">
            {numbers.map((n) => (
              <li key={n.e164} className="font-mono">
                {n.e164} <span className="font-sans text-xs text-muted">{n.carrier} → {n.agent_name ?? "nobody"}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Recent calls</h2>
          <Link href={`/admin/calls?tenant=${tenant.id}`} className="text-sm underline">All calls</Link>
        </div>
        {calls.length === 0 ? (
          <p className="text-sm text-muted">No calls yet.</p>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="table">
              <thead><tr><th className="pl-4">When</th><th>Agent</th><th>Channel</th><th>Duration</th><th>Outcome</th></tr></thead>
              <tbody>
                {calls.map((c) => (
                  <tr key={c.id}>
                    <td className="pl-4"><Link className="underline" href={`/admin/calls/${c.id}`}>{formatDateTime(c.started_at)}</Link></td>
                    <td>{c.agent_name ?? "—"}</td>
                    <td>{c.channel}</td>
                    <td className="tabular-nums">{formatDuration(c.duration_seconds)}</td>
                    <td>{c.outcome.replaceAll("_", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {tenant.id !== admin.tenantId && (
        <section className="rounded-lg border border-critical/40 p-5">
          <h2 className="font-medium">Delete client</h2>
          <p className="mt-1 text-sm text-muted">
            Permanently deletes this client, its users, agents, phone numbers and all call history. To stop service but keep the data, set the status to Suspended instead.
          </p>
          <form action={deleteClient} className="mt-3 flex flex-wrap gap-2">
            <input type="hidden" name="id" value={tenant.id} />
            <input className="input max-w-xs" name="confirm" placeholder={`Type "${tenant.name}" to confirm`} required autoComplete="off" />
            <button className="btn-secondary text-critical">Delete permanently</button>
          </form>
          {deleteMismatch && <p className="mt-2 text-sm text-critical">▲ <span className="text-foreground">The name didn&apos;t match, so nothing was deleted.</span></p>}
        </section>
      )}
    </div>
  );
}

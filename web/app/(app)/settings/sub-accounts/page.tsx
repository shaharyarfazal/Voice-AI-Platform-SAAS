import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { sql } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { isTopLevel } from "@/lib/workspace";
import { switchWorkspace } from "../actions";
import { SubAccountForm } from "./sub-account-form";

export default async function SubAccountsPage() {
  const session = await requireRole("admin");
  if (!(await isTopLevel(session.tenantId))) notFound();
  const children = await sql<{ id: string; name: string; status: string; created_at: Date; members: number; agents: number; minutes: number }[]>`
    SELECT t.id, t.name, t.status, t.created_at,
      (SELECT count(*)::int FROM memberships m WHERE m.tenant_id = t.id) AS members,
      (SELECT count(*)::int FROM agents a WHERE a.tenant_id = t.id) AS agents,
      (SELECT coalesce(sum(duration_seconds), 0)::int / 60 FROM calls c WHERE c.tenant_id = t.id AND c.started_at >= date_trunc('month', now())) AS minutes
    FROM tenants t WHERE t.parent_id = ${session.tenantId} ORDER BY t.created_at DESC`;

  return (
    <div className="space-y-8">
      <p className="text-sm text-muted">
        Give each of your clients their own workspace. They see your branding (set it under White label), and you can open any of
        them from the workspace switcher.
      </p>
      <SubAccountForm />
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Client workspaces <span className="text-sm font-normal text-muted">({children.length})</span></h2>
        {children.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Workspace</th><th>Members</th><th>Agents</th><th>Minutes this month</th><th><span className="sr-only">Open</span></th></tr></thead>
              <tbody>
                {children.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-muted">Created {formatDateTime(c.created_at)}{c.status !== "active" ? " · suspended" : ""}</div>
                    </td>
                    <td className="tabular-nums">{c.members}</td>
                    <td className="tabular-nums">{c.agents}</td>
                    <td className="tabular-nums">{c.minutes}</td>
                    <td className="text-right">
                      <form action={switchWorkspace}>
                        <input type="hidden" name="tenantId" value={c.id} />
                        <button className="btn-secondary py-1">Open</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

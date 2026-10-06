import { requireRole } from "@/lib/auth";
import { sql } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { changeRole, removeMember, revokeInvite } from "../actions";
import { InviteForm } from "./invite-form";

export default async function TeamPage() {
  const session = await requireRole("admin");
  const [members, invites] = await Promise.all([
    sql<{ user_id: string; email: string; name: string; role: string; created_at: Date; last_login_at: Date | null }[]>`
      SELECT m.user_id, u.email, u.name, m.role, m.created_at, u.last_login_at
      FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ${session.tenantId} ORDER BY m.created_at`,
    sql<{ id: string; email: string; role: string; expires_at: Date }[]>`
      SELECT id, email, role, expires_at FROM invites
      WHERE tenant_id = ${session.tenantId} AND accepted_at IS NULL AND expires_at > now() ORDER BY created_at DESC`,
  ]);
  const owner = session.role === "owner";

  return (
    <div className="space-y-8">
      <InviteForm />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Members <span className="text-sm font-normal text-muted">({members.length})</span></h2>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Person</th><th>Role</th><th>Last sign-in</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {members.map((m) => {
                const self = m.user_id === session.userId;
                const canEdit = !self && (owner || m.role !== "owner");
                return (
                  <tr key={m.user_id}>
                    <td>
                      <div className="font-medium">{m.name || m.email}{self && <span className="ml-2 text-xs text-muted">(you)</span>}</div>
                      {m.name && <div className="text-xs text-muted">{m.email}</div>}
                    </td>
                    <td>
                      {canEdit ? (
                        <form action={changeRole} className="flex items-center gap-2">
                          <input type="hidden" name="userId" value={m.user_id} />
                          <select name="role" defaultValue={m.role} className="input w-auto py-1" aria-label={`Role for ${m.email}`}>
                            {owner && <option value="owner">Owner</option>}
                            <option value="admin">Admin</option>
                            <option value="member">Member</option>
                          </select>
                          <button className="text-sm underline">Save</button>
                        </form>
                      ) : (
                        <span className="badge capitalize">{m.role}</span>
                      )}
                    </td>
                    <td className="text-sm text-muted">{m.last_login_at ? formatDateTime(m.last_login_at) : "Never"}</td>
                    <td className="text-right">
                      {canEdit && (
                        <form action={removeMember}>
                          <input type="hidden" name="userId" value={m.user_id} />
                          <button className="text-sm text-muted underline hover:text-critical">Remove</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted">
          <strong className="font-medium text-foreground">Owners</strong> and <strong className="font-medium text-foreground">admins</strong> manage the team, API keys and settings.{" "}
          <strong className="font-medium text-foreground">Members</strong> work with agents, calls, chats and the knowledge base.
        </p>
      </section>

      {invites.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Pending invites</h2>
          <table className="table">
            <thead><tr><th>Email</th><th>Role</th><th>Expires</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td className="capitalize">{i.role}</td>
                  <td className="text-sm text-muted">{formatDateTime(i.expires_at)}</td>
                  <td className="text-right">
                    <form action={revokeInvite}>
                      <input type="hidden" name="id" value={i.id} />
                      <button className="text-sm text-muted underline hover:text-critical">Revoke</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-sm text-muted">Lost a link? Invite the same email again for a new one; the old link stops working.</p>
        </section>
      )}
    </div>
  );
}

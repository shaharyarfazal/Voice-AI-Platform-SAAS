import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { deleteUser, setAdmin } from "./actions";
import { ResetPassword } from "./reset-password";

export default async function UsersPage() {
  const admin = await requireAdmin();
  const envAdmins = (process.env.PLATFORM_ADMIN_EMAILS ?? "").toLowerCase().split(",").map((e) => e.trim());
  const users = await sql`
    SELECT u.id, u.email, u.is_platform_admin, u.last_login_at, u.created_at, u.terms_accepted_at,
           t.id AS tenant_id, t.name AS tenant_name
    FROM users u JOIN tenants t ON t.id = u.tenant_id ORDER BY u.created_at DESC`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="mt-1 text-sm text-muted">
          Admins can open this panel. Emails in PLATFORM_ADMIN_EMAILS are always admins. Add a new client and its first user on the Clients page.
        </p>
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr><th className="pl-4">Email</th><th>Client</th><th>Role</th><th>Last login</th><th>Password</th><th /></tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.id === admin.userId;
              const envAdmin = envAdmins.includes(u.email);
              return (
                <tr key={u.id}>
                  <td className="pl-4">
                    {u.email}
                    <div className="text-xs text-muted">
                      Joined {formatDateTime(u.created_at)}
                      {u.terms_accepted_at && ` · accepted terms ${formatDateTime(u.terms_accepted_at)}`}
                    </div>
                  </td>
                  <td><Link className="underline" href={`/admin/tenants/${u.tenant_id}`}>{u.tenant_name}</Link></td>
                  <td>
                    {envAdmin ? (
                      <span className="text-sm">Admin <span className="text-xs text-muted">(env)</span></span>
                    ) : (
                      <form action={setAdmin} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={u.id} />
                        <input type="hidden" name="value" value={String(!u.is_platform_admin)} />
                        <span className="text-sm">{u.is_platform_admin ? "Admin" : "Client"}</span>
                        {!isSelf && (
                          <button className="text-xs underline">{u.is_platform_admin ? "Remove admin" : "Make admin"}</button>
                        )}
                      </form>
                    )}
                  </td>
                  <td className="text-sm">{u.last_login_at ? formatDateTime(u.last_login_at) : "Never"}</td>
                  <td><ResetPassword id={u.id} /></td>
                  <td>
                    {!isSelf && (
                      <form action={deleteUser}>
                        <input type="hidden" name="id" value={u.id} />
                        <button className="text-xs text-critical underline">Delete</button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

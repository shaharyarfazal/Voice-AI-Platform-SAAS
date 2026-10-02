import { requireSession } from "@/lib/auth";
import { sql } from "@/lib/db";

export default async function AppointmentsPage() {
  const { tenantId } = await requireSession();
  const rows = await sql`
    SELECT ap.id, ap.starts_at, ap.ends_at, ap.timezone, ap.customer_name, ap.customer_phone, ap.customer_email, ap.notes,
           a.name AS agent_name, i.provider, i.account_email
    FROM appointments ap
    LEFT JOIN agents a ON a.id = ap.agent_id
    LEFT JOIN integrations i ON i.id = ap.integration_id
    WHERE ap.tenant_id = ${tenantId}
    ORDER BY ap.starts_at DESC LIMIT 200`;
  const upcoming = rows.filter((r) => r.starts_at >= new Date());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Appointments</h1>
        <p className="page-sub">Booked by your agents during calls. {upcoming.length} upcoming.</p>
      </div>
      {rows.length === 0 ? (
        <p className="card text-sm text-muted">No appointments yet. Connect a calendar on Integrations and turn on booking for an agent.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead><tr><th className="pl-4">When</th><th>Customer</th><th>Contact</th><th>Notes</th><th>Booked by</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.starts_at < new Date() ? "text-muted" : ""}>
                  <td className="pl-4 whitespace-nowrap">
                    {r.starts_at.toLocaleString("en-US", { timeZone: r.timezone, dateStyle: "medium", timeStyle: "short" })}
                    <div className="text-xs text-muted">{r.timezone}</div>
                  </td>
                  <td>{r.customer_name}</td>
                  <td className="text-sm">{[r.customer_phone, r.customer_email].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="max-w-xs text-sm">{r.notes || "—"}</td>
                  <td className="text-sm">
                    {r.agent_name ?? "—"}
                    {r.account_email && <div className="text-xs text-muted">{r.provider === "google" ? "Google" : "Outlook"}: {r.account_email}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

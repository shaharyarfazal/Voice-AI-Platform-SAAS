import { requireSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { assignAgent, removeNumber } from "./actions";
import { AddNumberForm } from "./add-number-form";

export default async function NumbersPage() {
  const { tenantId } = await requireSession();
  const [numbers, agents] = await Promise.all([
    sql`SELECT id, e164, carrier, agent_id FROM phone_numbers WHERE tenant_id = ${tenantId} ORDER BY created_at`,
    sql<{ id: string; name: string }[]>`SELECT id, name FROM agents WHERE tenant_id = ${tenantId} ORDER BY name`,
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Phone numbers</h1>
        <p className="mt-1 text-sm text-muted">
          Point each number at your SIP server in Telnyx or Twilio first (see docs/telephony.md), then add it here.
        </p>
      </div>
      <AddNumberForm agents={agents} />
      {numbers.length > 0 && (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Carrier</th>
                <th>Answered by</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {numbers.map((n) => (
                <tr key={n.id}>
                  <td className="font-mono">{n.e164}</td>
                  <td className="capitalize">{n.carrier}</td>
                  <td>
                    <form action={assignAgent} className="flex gap-2">
                      <input type="hidden" name="id" value={n.id} />
                      <select className="input max-w-56" name="agentId" defaultValue={n.agent_id ?? ""}>
                        <option value="">Nobody</option>
                        {agents.map((a) => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                      <button className="btn-secondary">Save</button>
                    </form>
                  </td>
                  <td className="text-right">
                    <form action={removeNumber}>
                      <input type="hidden" name="id" value={n.id} />
                      <button className="text-sm text-red-600 hover:underline">Remove</button>
                    </form>
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

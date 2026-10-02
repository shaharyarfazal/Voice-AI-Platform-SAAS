import { requireSession } from "@/lib/auth";
import { sql, type CallRow } from "@/lib/db";
import { CallTable } from "./call-table";

export default async function CallsPage() {
  const { tenantId } = await requireSession();
  const calls = await sql<CallRow[]>`
    SELECT c.*, a.name AS agent_name FROM calls c LEFT JOIN agents a ON a.id = c.agent_id
    WHERE c.tenant_id = ${tenantId} ORDER BY c.started_at DESC LIMIT 200`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Calls</h1>
      <CallTable calls={calls} />
    </div>
  );
}

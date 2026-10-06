import { exportAgent } from "@/lib/agent-io";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/validation";

// Downloads an agent as JSON (credentials and calendar/knowledge links left out).
export async function GET(_: Request, { params }: RouteContext<"/api/files/agents/[id]/export">) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return new Response("Not found", { status: 404 });
  const [row] = await sql`SELECT * FROM agents WHERE id = ${id} AND tenant_id = ${session.tenantId}`;
  if (!row) return new Response("Not found", { status: 404 });
  const file = `${String(row.name).replace(/[^\w-]+/g, "-").toLowerCase() || "agent"}.json`;
  return new Response(JSON.stringify(exportAgent(row as never), null, 2), {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${file}"` },
  });
}

import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { createTestCallToken } from "@/lib/livekit";
import { isUuid } from "@/lib/validation";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { agentId } = (await request.json()) as { agentId?: string };
  if (!isUuid(agentId)) return new Response("agentId is required", { status: 400 });

  const [agent] = await sql`SELECT id FROM agents WHERE id = ${agentId} AND tenant_id = ${session.tenantId}`;
  if (!agent) return new Response("Not found", { status: 404 });

  return Response.json(await createTestCallToken(agentId, session.userId));
}

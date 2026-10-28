import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { createTestCallToken } from "@/lib/livekit";
import { isUuid } from "@/lib/validation";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { agentId } = (await request.json()) as { agentId?: string };
  if (!isUuid(agentId)) return new Response("agentId is required", { status: 400 });

  // Signing the token needs no answer from the agent lookup, so both run at once.
  const [[agent], token] = await Promise.all([
    sql`SELECT id FROM agents WHERE id = ${agentId} AND tenant_id = ${session.tenantId}`,
    createTestCallToken(agentId, session.userId),
  ]);
  if (!agent) return new Response("Not found", { status: 404 });

  return Response.json(token);
}

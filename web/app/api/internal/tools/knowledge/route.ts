import { z } from "zod";
import { isInternalRequest } from "@/lib/auth";
import { sql } from "@/lib/db";
import { formatHits, searchKnowledge } from "@/lib/knowledge/search";

const Body = z.object({ agentId: z.uuid(), query: z.string().min(1).max(500) });

// Agent tool: search_knowledge_base(query)
export async function POST(request: Request) {
  if (!isInternalRequest(request)) return new Response("Unauthorized", { status: 401 });
  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) return Response.json({ result: "Invalid request", hits: 0 }, { status: 400 });
  const [agent] = await sql<{ tenant_id: string; knowledge_base_ids: string[] }[]>`
    SELECT tenant_id, knowledge_base_ids FROM agents WHERE id = ${parsed.data.agentId}`;
  if (!agent) return Response.json({ result: "Agent not found", hits: 0 }, { status: 404 });
  const hits = await searchKnowledge(agent.tenant_id, agent.knowledge_base_ids, parsed.data.query, 4);
  return Response.json({ result: formatHits(hits), hits: hits.length });
}

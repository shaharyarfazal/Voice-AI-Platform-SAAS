import { isInternalRequest } from "@/lib/auth";
import { sql, type AgentRow } from "@/lib/db";
import { isUuid } from "@/lib/validation";

// Called by the agent worker at the start of every call.
export async function GET(request: Request) {
  if (!isInternalRequest(request)) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agentId");
  const number = searchParams.get("number");

  let rows: AgentRow[] = [];
  if (isUuid(agentId)) {
    rows = await sql<AgentRow[]>`SELECT * FROM agents WHERE id = ${agentId}`;
  } else if (number) {
    rows = await sql<AgentRow[]>`
      SELECT a.* FROM phone_numbers p JOIN agents a ON a.id = p.agent_id WHERE p.e164 = ${number}`;
  }
  const agent = rows[0];
  if (!agent) return new Response("Not found", { status: 404 });

  return Response.json({
    id: agent.id,
    greeting: agent.greeting,
    systemPrompt: agent.system_prompt,
    voiceId: agent.voice_id,
    language: agent.language,
    llmModel: agent.llm_model,
    transferNumber: agent.transfer_number,
  });
}

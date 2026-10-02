import { isInternalRequest } from "@/lib/auth";
import { buildRuntimeConfig, type FullAgentRow } from "@/lib/agent-runtime-config";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/validation";

type AgentWithTenant = FullAgentRow & {
  announce_ai: boolean;
  tenant_status: string;
  monthly_minute_limit: number | null;
  minutes_this_month: number;
};

// Called by the agent worker at the start of every call. A 404 makes the agent hang up before
// any AI provider is used: unknown number, suspended tenant, or monthly minute limit reached.
export async function GET(request: Request) {
  if (!isInternalRequest(request)) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agentId");
  const number = searchParams.get("number");

  const select = sql`
    SELECT a.*, t.name AS tenant_name, t.status AS tenant_status, t.monthly_minute_limit,
      (SELECT coalesce(sum(duration_seconds), 0)::int / 60 FROM calls
        WHERE tenant_id = t.id AND started_at >= date_trunc('month', now())) AS minutes_this_month
    FROM agents a JOIN tenants t ON t.id = a.tenant_id`;
  let rows: AgentWithTenant[] = [];
  if (isUuid(agentId)) {
    rows = await sql<AgentWithTenant[]>`${select} WHERE a.id = ${agentId}`;
  } else if (number) {
    rows = await sql<AgentWithTenant[]>`
      ${select} JOIN phone_numbers p ON p.agent_id = a.id WHERE p.e164 = ${number}`;
  }
  const agent = rows[0];
  if (!agent) return new Response("Not found", { status: 404 });
  if (agent.tenant_status !== "active") return new Response("Tenant suspended", { status: 404 });
  if (agent.monthly_minute_limit !== null && agent.minutes_this_month >= agent.monthly_minute_limit) {
    return new Response("Monthly minute limit reached", { status: 404 });
  }

  return Response.json(await buildRuntimeConfig(agent));
}

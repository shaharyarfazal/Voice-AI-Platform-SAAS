import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { sql, type AgentRow } from "@/lib/db";
import { isUuid } from "@/lib/validation";
import { deleteAgent } from "../actions";
import { AgentForm } from "../agent-form";
import { TestCall } from "./test-call";

export default async function AgentPage({ params }: PageProps<"/agents/[id]">) {
  const { tenantId } = await requireSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [agent] = await sql<AgentRow[]>`SELECT * FROM agents WHERE id = ${id} AND tenant_id = ${tenantId}`;
  if (!agent) notFound();

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{agent.name}</h1>
        <form action={deleteAgent}>
          <input type="hidden" name="id" value={agent.id} />
          <button className="btn-secondary text-red-600">Delete agent</button>
        </form>
      </div>
      <TestCall agentId={agent.id} />
      <AgentForm key={agent.id} agent={agent} />
    </div>
  );
}

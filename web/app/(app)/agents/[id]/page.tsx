import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { languageLabel } from "@/lib/catalog";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/validation";
import { deleteAgent } from "../actions";
import { AgentEditor } from "../editor/agent-editor";
import { loadEditorContext } from "../editor/load-context";
import { toEditorState } from "../editor/to-state";
import { TestCall } from "./test-call";

export default async function AgentPage({ params }: PageProps<"/agents/[id]">) {
  const { tenantId } = await requireSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [[agent], context, [numbers]] = await Promise.all([
    sql`SELECT * FROM agents WHERE id = ${id} AND tenant_id = ${tenantId}`,
    loadEditorContext(tenantId),
    sql`SELECT count(*)::int AS n FROM phone_numbers WHERE agent_id = ${id}`,
  ]);
  if (!agent) notFound();
  const initial = toEditorState(agent as never);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/agents" className="text-sm text-muted hover:underline">← Agents</Link>
          <h1 className="page-title mt-1">{agent.name}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="badge">{languageLabel(initial.language)}</span>
            <span className="badge">{initial.providers.llm.model}</span>
            <span className="badge">{numbers.n} phone number{numbers.n === 1 ? "" : "s"}</span>
            {initial.tools.booking && <span className="badge">Booking on</span>}
            {initial.tools.custom.length + initial.tools.mcp.length > 0 && (
              <span className="badge">{initial.tools.custom.length + initial.tools.mcp.length} integrations</span>
            )}
          </div>
        </div>
        <form action={deleteAgent}>
          <input type="hidden" name="id" value={agent.id} />
          <button className="text-sm text-muted underline hover:text-critical">Delete agent</button>
        </form>
      </div>
      <TestCall agentId={agent.id} />
      <AgentEditor id={agent.id} initial={initial} context={context} />
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { languageLabel } from "@/lib/catalog";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/validation";
import { deleteAgent, duplicate } from "../actions";
import { AgentEditor } from "../editor/agent-editor";
import { loadEditorContext } from "../editor/load-context";
import { toEditorState } from "../editor/to-state";
import { OutboundCall } from "./outbound-call";
import { TestCall } from "./test-call";
import { TestChat } from "./test-chat";

const TYPE_LABEL = { inbound: "Inbound calls", outbound: "Outbound calls", chat: "Chatbot" } as const;

export default async function AgentPage({ params }: PageProps<"/agents/[id]">) {
  const { tenantId } = await requireSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [[agent], context, [counts], numbers] = await Promise.all([
    sql`SELECT * FROM agents WHERE id = ${id} AND tenant_id = ${tenantId}`,
    loadEditorContext(tenantId),
    sql<{ numbers: number; widgets: number }[]>`
      SELECT (SELECT count(*)::int FROM phone_numbers WHERE agent_id = ${id}) AS numbers,
             (SELECT count(*)::int FROM widgets WHERE agent_id = ${id}) AS widgets`,
    sql<{ e164: string }[]>`SELECT e164 FROM phone_numbers WHERE tenant_id = ${tenantId} ORDER BY e164`,
  ]);
  if (!agent) notFound();
  const initial = toEditorState(agent as never);
  const chat = initial.type === "chat";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href={chat ? "/chatbots" : "/agents"} className="text-sm text-muted hover:underline">← {chat ? "Chatbots" : "Voice agents"}</Link>
          <h1 className="page-title mt-1 truncate">{agent.name}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="badge">{TYPE_LABEL[initial.type]}</span>
            <span className="badge">{languageLabel(initial.language)}</span>
            <span className="badge">{initial.providers.mode === "realtime" && !chat ? `Realtime · ${initial.providers.realtime.model}` : initial.providers.llm.model}</span>
            {initial.type === "inbound" && <span className="badge">{counts.numbers} phone number{counts.numbers === 1 ? "" : "s"}</span>}
            {initial.knowledgeBaseIds.length > 0 && <span className="badge">Knowledge on</span>}
            {initial.tools.booking && <span className="badge">Booking on</span>}
            {counts.widgets > 0 && <span className="badge">{counts.widgets} widget{counts.widgets === 1 ? "" : "s"}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <form action={duplicate}>
            <input type="hidden" name="id" value={agent.id} />
            <button className="btn-secondary py-1.5">Duplicate</button>
          </form>
          <a href={`/api/files/agents/${agent.id}/export`} className="btn-secondary py-1.5" download>Export JSON</a>
          <Link href={`/widgets/new?agent=${agent.id}`} className="btn-secondary py-1.5">Add to website</Link>
          <form action={deleteAgent}>
            <input type="hidden" name="id" value={agent.id} />
            <button className="text-muted underline hover:text-critical">Delete</button>
          </form>
        </div>
      </div>
      {chat ? <TestChat agentId={agent.id} /> : <TestCall agentId={agent.id} />}
      {initial.type === "outbound" && <OutboundCall agentId={agent.id} numbers={numbers.map((n) => n.e164)} />}
      <AgentEditor id={agent.id} initial={initial} context={context} />
    </div>
  );
}

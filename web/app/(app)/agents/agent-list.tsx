import Link from "next/link";
import { sql } from "@/lib/db";
import { ImportAgentButton } from "./import-agent";

const TYPE_LABEL = { inbound: "Inbound", outbound: "Outbound", chat: "Chatbot" } as const;

/** Agents of the given types, as cards. Shared by Voice agents and Chatbots. */
export async function AgentList({ tenantId, types, title, sub, newHref, empty }: {
  tenantId: string;
  types: ("inbound" | "outbound" | "chat")[];
  title: string;
  sub: string;
  newHref: string;
  empty: string;
}) {
  const agents = await sql<{ id: string; name: string; type: keyof typeof TYPE_LABEL; llm_model: string; numbers: number; widgets: number; kbs: number; calls: number; chats: number }[]>`
    SELECT a.id, a.name, a.type, a.llm_model,
      (SELECT count(*)::int FROM phone_numbers p WHERE p.agent_id = a.id) AS numbers,
      (SELECT count(*)::int FROM widgets w WHERE w.agent_id = a.id) AS widgets,
      cardinality(a.knowledge_base_ids) AS kbs,
      (SELECT count(*)::int FROM calls c WHERE c.agent_id = a.id AND c.started_at > now() - interval '30 days') AS calls,
      (SELECT count(*)::int FROM chat_sessions s WHERE s.agent_id = a.id AND s.started_at > now() - interval '30 days') AS chats
    FROM agents a WHERE a.tenant_id = ${tenantId} AND a.type = ANY(${types}) ORDER BY a.created_at`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-sub">{sub}</p>
        </div>
        <div className="flex gap-2">
          <ImportAgentButton />
          <Link className="btn" href={newHref}>New</Link>
        </div>
      </div>
      {agents.length === 0 ? (
        <div className="card text-center">
          <p className="font-medium">Nothing here yet</p>
          <p className="mt-1 text-sm text-muted">{empty}</p>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {agents.map((a) => (
            <li key={a.id}>
              <Link href={`/agents/${a.id}`} className="card block transition hover:border-accent">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{a.name}</span>
                  <span className="badge">{TYPE_LABEL[a.type]}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
                  <span>{a.llm_model}</span>
                  {a.type === "inbound" && <span>{a.numbers} number{a.numbers === 1 ? "" : "s"}</span>}
                  {a.kbs > 0 && <span>Knowledge on</span>}
                  {a.widgets > 0 && <span>{a.widgets} widget{a.widgets === 1 ? "" : "s"}</span>}
                  <span>{a.type === "chat" ? `${a.chats} chats` : `${a.calls} calls`} in 30 days</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

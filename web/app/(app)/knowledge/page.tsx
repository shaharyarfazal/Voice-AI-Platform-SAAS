import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { createKnowledgeBase } from "./actions";

export default async function KnowledgePage() {
  const { tenantId } = await requireSession();
  const bases = await sql<{ id: string; name: string; sources: number; chunks: number; busy: number; agents: number }[]>`
    SELECT k.id, k.name,
      (SELECT count(*)::int FROM kb_sources s WHERE s.kb_id = k.id) AS sources,
      (SELECT coalesce(sum(chunks), 0)::int FROM kb_sources s WHERE s.kb_id = k.id) AS chunks,
      (SELECT count(*)::int FROM kb_sources s WHERE s.kb_id = k.id AND s.status IN ('queued', 'processing')) AS busy,
      (SELECT count(*)::int FROM agents a WHERE k.id = ANY(a.knowledge_base_ids)) AS agents
    FROM knowledge_bases k WHERE k.tenant_id = ${tenantId} ORDER BY k.created_at`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Knowledge base</h1>
          <p className="page-sub">Your website, documents and notes. Agents and chatbots look things up here while they talk.</p>
        </div>
        <form action={createKnowledgeBase} className="flex w-full gap-2 sm:w-auto">
          <input className="input min-w-0 flex-1 sm:w-48 sm:flex-none" name="name" placeholder="Name" aria-label="Knowledge base name" />
          <button className="btn whitespace-nowrap">New knowledge base</button>
        </form>
      </div>
      {bases.length === 0 ? (
        <div className="card text-center">
          <p className="font-medium">No knowledge yet</p>
          <p className="mt-1 text-sm text-muted">Create a knowledge base, then add your website or upload PDFs and Word documents.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {bases.map((b) => (
            <Link key={b.id} href={`/knowledge/${b.id}`} className="card block transition hover:border-accent">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{b.name}</span>
                {b.busy > 0 && <span className="badge">Processing {b.busy}</span>}
              </div>
              <p className="mt-2 text-sm text-muted">
                {b.sources} source{b.sources === 1 ? "" : "s"} · {b.chunks} passages · used by {b.agents} agent{b.agents === 1 ? "" : "s"}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

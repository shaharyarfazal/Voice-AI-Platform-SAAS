import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { embeddingsAvailable } from "@/lib/knowledge/embed";
import { isUuid } from "@/lib/validation";
import { deleteKnowledgeBase, deleteSource, renameKnowledgeBase, resyncSource } from "../actions";
import { AddSources, AutoRefresh, TestSearch } from "./client";

const KIND = { website: "Website", url: "Web page", file: "Document", text: "Text" } as const;

export default async function KnowledgeBasePage({ params }: PageProps<"/knowledge/[id]">) {
  const { tenantId } = await requireSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [kb] = await sql<{ id: string; name: string }[]>`SELECT id, name FROM knowledge_bases WHERE id = ${id} AND tenant_id = ${tenantId}`;
  if (!kb) notFound();
  const [sources, agents] = await Promise.all([
    sql<{ id: string; kind: keyof typeof KIND; title: string; url: string | null; status: string; error: string | null; pages: number; chunks: number; chars: number; updated_at: Date }[]>`
      SELECT id, kind, title, url, status, error, pages, chunks, chars, updated_at FROM kb_sources WHERE kb_id = ${id} ORDER BY created_at DESC`,
    sql<{ id: string; name: string }[]>`SELECT id, name FROM agents WHERE tenant_id = ${tenantId} AND ${id}::uuid = ANY(knowledge_base_ids)`,
  ]);
  const busy = sources.some((s) => s.status === "queued" || s.status === "processing");

  return (
    <div className="space-y-8">
      <AutoRefresh active={busy} />
      <div>
        <Link href="/knowledge" className="text-sm text-muted hover:underline">← Knowledge base</Link>
        <form action={renameKnowledgeBase} className="mt-1 flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={kb.id} />
          <input name="name" defaultValue={kb.name} aria-label="Name" className="-ml-1 rounded px-1 text-2xl font-semibold tracking-tight outline-none hover:bg-surface focus:bg-surface" />
          <button className="text-sm text-muted underline">Rename</button>
        </form>
        <p className="page-sub">
          {agents.length ? (
            <>Used by {agents.map((a, i) => <span key={a.id}>{i > 0 && ", "}<Link className="underline" href={`/agents/${a.id}`}>{a.name}</Link></span>)}.</>
          ) : (
            <>Not connected to an agent yet: open an agent, then Tools → Knowledge base.</>
          )}
          {!embeddingsAvailable() && " Keyword search only: add OPENAI_API_KEY to the web app for meaning-based search."}
        </p>
      </div>

      <AddSources kbId={kb.id} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Sources</h2>
        {sources.length === 0 ? (
          <p className="text-sm text-muted">Nothing added yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {sources.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="badge">{KIND[s.kind]}</span>
                    <span className="truncate font-medium">{s.title}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="underline">{s.url}</a>}
                    {s.url && " · "}
                    {s.status === "ready" && `${s.kind === "website" ? `${s.pages} pages · ` : ""}${s.chunks} passages · updated ${formatDateTime(s.updated_at)}`}
                    {s.status === "processing" && (s.kind === "website" ? `Reading the site… ${s.pages} pages so far` : "Processing…")}
                    {s.status === "queued" && "Waiting…"}
                  </div>
                  {s.status === "error" && <p className="mt-1 text-sm text-critical">▲ <span className="text-foreground">{s.error}</span></p>}
                </div>
                <div className="flex items-center gap-3 text-sm">
                  {(s.status === "processing" || s.status === "queued") && <span className="text-muted" aria-live="polite">⟳ Working</span>}
                  {s.status === "ready" && <span className="text-good">✓ <span className="text-foreground">Ready</span></span>}
                  {(s.kind === "website" || s.kind === "url") && s.status !== "processing" && (
                    <form action={resyncSource}><input type="hidden" name="id" value={s.id} /><button className="text-muted underline">Re-sync</button></form>
                  )}
                  <form action={deleteSource}><input type="hidden" name="id" value={s.id} /><button className="text-muted underline hover:text-critical">Delete</button></form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <TestSearch kbId={kb.id} />

      <form action={deleteKnowledgeBase} className="border-t border-border pt-6">
        <input type="hidden" name="id" value={kb.id} />
        <button className="text-sm text-muted underline hover:text-critical">Delete this knowledge base</button>
      </form>
    </div>
  );
}

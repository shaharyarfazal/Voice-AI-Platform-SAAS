import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { sql, type CallRow } from "@/lib/db";
import { CallTable } from "./calls/call-table";

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  const { tenantId } = await requireSession();
  const { welcome } = await searchParams;

  const [[stats], recent] = await Promise.all([
    sql<{ agents: number; chatbots: number; numbers: number; widgets: number; kbs: number; calls: number; seconds: number; chats: number }[]>`
      SELECT
        (SELECT count(*)::int FROM agents WHERE tenant_id = ${tenantId} AND type <> 'chat') AS agents,
        (SELECT count(*)::int FROM agents WHERE tenant_id = ${tenantId} AND type = 'chat') AS chatbots,
        (SELECT count(*)::int FROM phone_numbers WHERE tenant_id = ${tenantId}) AS numbers,
        (SELECT count(*)::int FROM widgets WHERE tenant_id = ${tenantId}) AS widgets,
        (SELECT count(*)::int FROM kb_sources WHERE tenant_id = ${tenantId} AND status = 'ready') AS kbs,
        (SELECT count(*)::int FROM chat_sessions WHERE tenant_id = ${tenantId} AND started_at >= date_trunc('month', now())) AS chats,
        count(*)::int AS calls,
        coalesce(sum(duration_seconds), 0)::int AS seconds
      FROM calls WHERE tenant_id = ${tenantId} AND started_at >= date_trunc('month', now())`,
    sql<CallRow[]>`
      SELECT c.*, a.name AS agent_name FROM calls c LEFT JOIN agents a ON a.id = c.agent_id
      WHERE c.tenant_id = ${tenantId} ORDER BY c.started_at DESC LIMIT 10`,
  ]);

  const tiles = [
    { label: "Calls this month", value: stats.calls },
    { label: "Minutes this month", value: Math.ceil(stats.seconds / 60) },
    { label: "Chats this month", value: stats.chats },
    { label: "Voice agents · chatbots", value: `${stats.agents} · ${stats.chatbots}` },
  ];
  const steps = [
    { done: stats.agents + stats.chatbots > 0, title: "Create your agents", body: "A receptionist, an outbound caller and a chatbot.", href: "/agents", cta: "Open agents" },
    { done: stats.kbs > 0, title: "Teach them about your business", body: "Add your website or documents to the knowledge base.", href: "/knowledge", cta: "Add knowledge" },
    { done: false, title: "Try a test call", body: "Talk to your receptionist from the browser.", href: "/agents", cta: "Test now" },
    { done: stats.numbers > 0, title: "Connect a phone number", body: "Calls to it are answered by your agent.", href: "/numbers", cta: "Add number" },
    { done: stats.widgets > 0, title: "Put the chatbot on your website", body: "One line of code: chat, click-to-call, or both.", href: "/widgets/new", cta: "Create widget" },
  ];
  const remaining = steps.filter((s) => !s.done).length;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-title">{welcome ? "You're all set up 🎉" : "Overview"}</h1>
          {welcome && <p className="page-sub">Your agents are ready. Here&apos;s how to get them working for you.</p>}
        </div>
        <Link className="btn" href="/agents/new">New agent</Link>
      </div>

      {(welcome || remaining > 1) && (
        <section className="card space-y-3" aria-label="Getting started">
          <h2 className="font-semibold">Getting started <span className="text-sm font-normal text-muted">({steps.length - remaining} of {steps.length} done)</span></h2>
          <ol className="divide-y divide-border">
            {steps.map((s, i) => (
              <li key={i} className="flex flex-wrap items-center gap-3 py-3">
                <span aria-hidden className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${s.done ? "bg-good text-white" : "border border-border text-muted"}`}>{s.done ? "✓" : i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-medium ${s.done ? "text-muted line-through" : ""}`}>{s.title}</div>
                  <div className="text-sm text-muted">{s.body}</div>
                </div>
                {!s.done && <Link href={s.href} className="btn-secondary py-1.5 text-sm">{s.cta}</Link>}
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="card">
            <div className="text-sm text-muted">{t.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{t.value}</div>
          </div>
        ))}
      </div>
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent calls</h2>
          <Link href="/calls" className="text-sm text-muted underline">All calls &amp; chats</Link>
        </div>
        {recent.length ? <CallTable calls={recent} /> : <p className="text-sm text-muted">No calls yet.</p>}
      </section>
    </div>
  );
}

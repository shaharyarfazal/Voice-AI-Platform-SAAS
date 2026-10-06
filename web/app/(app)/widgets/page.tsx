import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { sql } from "@/lib/db";

const MODE = { chat: "Chat", voice: "Voice call", both: "Chat + call" } as const;

export default async function WidgetsPage() {
  const { tenantId } = await requireSession();
  const widgets = await sql<{ id: string; name: string; mode: keyof typeof MODE; enabled: boolean; agent_name: string; origins: string[]; chats: number }[]>`
    SELECT w.id, w.name, w.mode, w.enabled, a.name AS agent_name, w.allowed_origins AS origins,
      (SELECT count(*)::int FROM chat_sessions s WHERE s.widget_id = w.id AND s.started_at > now() - interval '30 days') AS chats
    FROM widgets w JOIN agents a ON a.id = w.agent_id WHERE w.tenant_id = ${tenantId} ORDER BY w.created_at`;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Widgets</h1>
          <p className="page-sub">Put a chatbot, a click-to-call button, or both on your website with one line of code.</p>
        </div>
        <Link href="/widgets/new" className="btn">New widget</Link>
      </div>
      {widgets.length === 0 ? (
        <div className="card text-center">
          <p className="font-medium">No widgets yet</p>
          <p className="mt-1 text-sm text-muted">Create one, pick the agent it talks to, and paste the embed code into your site.</p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {widgets.map((w) => (
            <li key={w.id}>
              <Link href={`/widgets/${w.id}`} className="card block transition hover:border-accent">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{w.name}</span>
                  <span className="badge">{w.enabled ? MODE[w.mode] : "Off"}</span>
                </div>
                <p className="mt-2 text-sm text-muted">
                  {w.agent_name} · {w.origins.length ? w.origins.map((o) => o.replace(/^https?:\/\//, "")).join(", ") : "any website"} · {w.chats} chats in 30 days
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

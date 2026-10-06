import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

const CHANNEL = { widget: "Website", api: "API", dashboard: "Test" } as const;

export default async function ChatsPage() {
  const { tenantId } = await requireSession();
  const chats = await sql<{ id: string; agent_name: string | null; widget_name: string | null; channel: keyof typeof CHANNEL; message_count: number; started_at: Date; last_message_at: Date; preview: string | null }[]>`
    SELECT s.id, a.name AS agent_name, w.name AS widget_name, s.channel, s.message_count, s.started_at, s.last_message_at,
      (SELECT m->>'content' FROM jsonb_array_elements(s.messages) m WHERE m->>'role' = 'user' LIMIT 1) AS preview
    FROM chat_sessions s LEFT JOIN agents a ON a.id = s.agent_id LEFT JOIN widgets w ON w.id = s.widget_id
    WHERE s.tenant_id = ${tenantId} ORDER BY s.last_message_at DESC LIMIT 200`;
  if (chats.length === 0) return <p className="text-sm text-muted">No chats yet. Add a chat widget to your website, or try a chatbot from its page.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead><tr><th>Started</th><th>Chatbot</th><th>Where</th><th>First message</th><th className="text-right">Messages</th></tr></thead>
        <tbody>
          {chats.map((c) => (
            <tr key={c.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
              <td className="whitespace-nowrap"><Link href={`/calls/chats/${c.id}`} className="underline">{formatDateTime(c.started_at)}</Link></td>
              <td>{c.agent_name ?? "Deleted"}</td>
              <td>{c.widget_name ?? CHANNEL[c.channel]}</td>
              <td className="max-w-xs truncate text-muted">{c.preview ?? "—"}</td>
              <td className="text-right tabular-nums">{c.message_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

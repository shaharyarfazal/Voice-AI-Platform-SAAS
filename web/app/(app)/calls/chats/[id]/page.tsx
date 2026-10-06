import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { isUuid } from "@/lib/validation";

export default async function ChatPage({ params }: PageProps<"/calls/chats/[id]">) {
  const { tenantId } = await requireSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [chat] = await sql<{ agent_name: string | null; channel: string; started_at: Date; messages: { role: "user" | "assistant"; content: string; at: string }[]; visitor: Record<string, unknown>; input_tokens: number; output_tokens: number }[]>`
    SELECT a.name AS agent_name, s.channel, s.started_at, s.messages, s.visitor, s.input_tokens, s.output_tokens
    FROM chat_sessions s LEFT JOIN agents a ON a.id = s.agent_id WHERE s.id = ${id} AND s.tenant_id = ${tenantId}`;
  if (!chat) notFound();
  const page = typeof chat.visitor.page === "string" ? chat.visitor.page : null;
  return (
    <div className="space-y-4">
      <Link href="/calls/chats" className="text-sm text-muted hover:underline">← Chats</Link>
      <p className="text-sm text-muted">
        {chat.agent_name ?? "Deleted chatbot"} · {formatDateTime(chat.started_at)} · {chat.channel}
        {page && <> · from <span className="break-all">{page}</span></>} · {chat.input_tokens + chat.output_tokens} tokens
      </p>
      <div className="space-y-3">
        {chat.messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "bg-accent text-white" : "bg-surface"}`}>
              <span className={`mb-0.5 block text-xs ${m.role === "user" ? "text-white/80" : "text-muted"}`}>{m.role === "user" ? "Visitor" : "Chatbot"}</span>
              {m.content}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

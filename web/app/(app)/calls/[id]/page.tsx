import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { sql, type CallRow } from "@/lib/db";
import { formatDateTime, formatDuration } from "@/lib/format";
import { isUuid } from "@/lib/validation";

export default async function CallPage({ params }: PageProps<"/calls/[id]">) {
  const { tenantId } = await requireSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [call] = await sql<CallRow[]>`
    SELECT c.*, a.name AS agent_name FROM calls c LEFT JOIN agents a ON a.id = c.agent_id
    WHERE c.id = ${id} AND c.tenant_id = ${tenantId}`;
  if (!call) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Call with {call.agent_name ?? "deleted agent"}</h1>
        <p className="mt-1 text-sm text-muted">
          {formatDateTime(call.started_at)} · {formatDuration(call.duration_seconds)} · {call.channel}
          {call.from_number && ` · from ${call.from_number}`} · {call.outcome.replaceAll("_", " ")}
        </p>
      </div>
      <div className="space-y-3">
        {call.transcript.length === 0 && <p className="text-sm text-muted">No transcript.</p>}
        {call.transcript.map((turn, i) => (
          <div key={i} className={turn.role === "assistant" ? "mr-12" : "ml-12 text-right"}>
            <div className="text-xs text-muted">{turn.role === "assistant" ? "Agent" : "Caller"}</div>
            <div
              className={`inline-block rounded-lg px-3 py-2 text-sm ${
                turn.role === "assistant" ? "bg-black/5 dark:bg-white/10" : "bg-blue-600 text-white"
              }`}
            >
              {turn.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

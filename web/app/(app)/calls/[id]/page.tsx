import { notFound } from "next/navigation";
import { LatencyStrip } from "@/components/latency";
import { Transcript } from "@/components/transcript";
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
      <LatencyStrip latency={call.latency} />
      <Transcript turns={call.transcript} purged={Boolean(call.transcript_purged_at)} />
    </div>
  );
}

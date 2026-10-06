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
  const deliveries = await sql<{ id: string; event: string; attempts: number; status_code: number | null; error: string | null; delivered_at: Date | null; created_at: Date }[]>`
    SELECT id, event, attempts, status_code, error, delivered_at, created_at FROM webhook_deliveries
    WHERE call_id = ${id} AND tenant_id = ${tenantId} ORDER BY created_at`;
  const a = call.analysis;
  const sentimentClass = { positive: "text-good", negative: "text-critical", neutral: "text-muted", unknown: "text-muted" } as const;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Call with {call.agent_name ?? "deleted agent"}</h1>
        <p className="mt-1 text-sm text-muted">
          {formatDateTime(call.started_at)} · {formatDuration(call.duration_seconds)} · {call.channel}
          {call.from_number && ` · from ${call.from_number}`} · {call.outcome.replaceAll("_", " ")}
        </p>
      </div>
      {call.has_recording && (
        <section className="card space-y-2">
          <h2 className="text-sm font-medium">Recording</h2>
          <audio controls preload="none" src={`/api/recordings/${call.id}`} className="w-full" />
          <a href={`/api/recordings/${call.id}?download=1`} className="text-sm text-muted underline">Download MP3</a>
        </section>
      )}
      {a && (
        <section className="card space-y-3">
          <h2 className="text-sm font-medium">Analysis</h2>
          {a.summary && <p className="text-sm">{a.summary}</p>}
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div>
              <dt className="inline text-muted">Sentiment: </dt>
              <dd className={`inline ${sentimentClass[a.user_sentiment]}`}>{a.user_sentiment}</dd>
            </div>
            <div>
              <dt className="inline text-muted">Successful: </dt>
              <dd className="inline">
                {a.call_successful === null ? "unknown" : a.call_successful ? <span className="text-good">✓ <span className="text-foreground">yes</span></span> : <span className="text-critical">✕ <span className="text-foreground">no</span></span>}
              </dd>
            </div>
            {Object.entries(a.custom_data).map(([k, v]) => (
              <div key={k}>
                <dt className="inline font-mono text-muted">{k}: </dt>
                <dd className="inline">{v === null || v === undefined ? "—" : String(v)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <LatencyStrip latency={call.latency} />
      <Transcript turns={call.transcript} purged={Boolean(call.transcript_purged_at)} />
      {deliveries.length > 0 && (
        <section className="card space-y-2">
          <h2 className="text-sm font-medium">Webhooks</h2>
          <table className="table">
            <thead><tr><th>Event</th><th>Result</th><th>Attempts</th><th>Sent</th></tr></thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id}>
                  <td className="font-mono text-sm">{d.event}</td>
                  <td className="text-sm">
                    {d.delivered_at ? (
                      <span className="text-good">✓ <span className="text-foreground">HTTP {d.status_code}</span></span>
                    ) : d.error ? (
                      <span className="text-critical">▲ <span className="text-foreground">{d.error}</span></span>
                    ) : (
                      <span className="text-muted">Sending…</span>
                    )}
                  </td>
                  <td className="tabular-nums">{d.attempts}</td>
                  <td className="text-sm text-muted">{formatDateTime(d.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

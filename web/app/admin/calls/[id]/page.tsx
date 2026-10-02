import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { formatDateTime, formatDuration, formatMoney } from "@/lib/format";
import { callCostSql, getSettings } from "@/lib/settings";
import { isUuid } from "@/lib/validation";

export default async function AdminCallPage({ params }: PageProps<"/admin/calls/[id]">) {
  await requireAdmin();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { rates } = await getSettings();
  const [call] = await sql`
    SELECT c.*, t.id AS tenant_id, t.name AS tenant_name, a.name AS agent_name, (${callCostSql(rates)})::float AS cost
    FROM calls c JOIN tenants t ON t.id = c.tenant_id LEFT JOIN agents a ON a.id = c.agent_id WHERE c.id = ${id}`;
  if (!call) notFound();
  const transcript = call.transcript as { role: string; text: string }[];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/calls" className="text-sm text-muted underline">← All calls</Link>
        <h1 className="mt-2 text-2xl font-semibold">
          <Link className="underline" href={`/admin/tenants/${call.tenant_id}`}>{call.tenant_name}</Link> · {call.agent_name ?? "deleted agent"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {formatDateTime(call.started_at)} · {formatDuration(call.duration_seconds)} · {call.channel}
          {call.from_number && ` · from ${call.from_number}`}
          {call.to_number && ` · to ${call.to_number}`} · {call.outcome.replaceAll("_", " ")}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {[
          ["Speech-to-text", `${Math.round(call.stt_seconds)} s`],
          ["LLM input", `${call.llm_input_tokens.toLocaleString()} tokens`],
          ["LLM output", `${call.llm_output_tokens.toLocaleString()} tokens`],
          ["Text-to-speech", `${call.tts_characters.toLocaleString()} chars`],
          ["Estimated cost", formatMoney(call.cost)],
        ].map(([label, value]) => (
          <div key={label} className="card">
            <div className="text-xs text-muted">{label}</div>
            <div className="mt-1 font-semibold tabular-nums">{value}</div>
          </div>
        ))}
      </div>
      <div className="space-y-3">
        {transcript.length === 0 && (
          <p className="text-sm text-muted">{call.transcript_purged_at ? "Transcript deleted under the client's retention policy." : "No transcript."}</p>
        )}
        {transcript.map((turn, i) => (
          <div key={i} className={turn.role === "assistant" ? "mr-12" : "ml-12 text-right"}>
            <div className="text-xs text-muted">{turn.role === "assistant" ? "Agent" : "Caller"}</div>
            <div className={`inline-block rounded-lg px-3 py-2 text-sm ${turn.role === "assistant" ? "bg-black/5 dark:bg-white/10" : "bg-blue-600 text-white"}`}>
              {turn.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export type Latency = {
  replies?: number;
  avgMs?: number | null;
  p90Ms?: number | null;
  endOfTurnMs?: number | null;
  transcriptionMs?: number | null;
  llmFirstTokenMs?: number | null;
  ttsFirstAudioMs?: number | null;
};

const fmt = (ms?: number | null) => (ms == null ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);

/** How quickly the agent answered on this call, and where the time went. */
export function LatencyStrip({ latency }: { latency: Latency }) {
  if (!latency?.replies) return null;
  const parts: [string, number | null | undefined, string][] = [
    ["Waiting for the caller to finish", latency.endOfTurnMs, "Pause detection (Response speed setting)"],
    ["AI first word", latency.llmFirstTokenMs, "LLM time to first token"],
    ["Voice first audio", latency.ttsFirstAudioMs, "Text-to-speech time to first audio"],
  ];
  return (
    <section className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">Response time</h2>
        <span className="text-xs text-muted">from the caller stopping to the agent starting to speak, {latency.replies} replies</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-5">
        <div>
          <div className="text-xs text-muted">Average</div>
          <div className="text-xl font-semibold tabular-nums">{fmt(latency.avgMs)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Slowest 10%</div>
          <div className="text-xl font-semibold tabular-nums">{fmt(latency.p90Ms)}</div>
        </div>
        {parts.map(([label, value, title]) => (
          <div key={label} title={title}>
            <div className="text-xs text-muted">{label}</div>
            <div className="text-xl font-semibold tabular-nums">{fmt(value)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function latencyLabel(latency: Latency | null | undefined): string {
  return latency?.avgMs == null ? "—" : fmt(latency.avgMs);
}

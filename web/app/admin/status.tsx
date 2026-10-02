/** Status is never colour alone: an icon and a word go with it. */
export function Status({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${ok ? "text-good" : "text-critical"}`}>
      <span aria-hidden>{ok ? "●" : "▲"}</span>
      <span className="text-foreground">{label ?? (ok ? "Up" : "Down")}</span>
    </span>
  );
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="card">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

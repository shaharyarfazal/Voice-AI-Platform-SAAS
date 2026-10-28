// Small server-rendered charts for the overview. One ink series, hatched; lime marks the point that
// matters (today, the latest value). Hovering a mark shows its value.

export type Day = { day: string; calls: number; minutes: number };

const short = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
const long = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Calls per day for the last 7 days; today is the lime bar. */
export function WeekBars({ days }: { days: Day[] }) {
  const max = Math.max(1, ...days.map((d) => d.calls));
  return (
    <div className="flex h-36 items-end gap-2" role="img" aria-label={`Calls per day: ${days.map((d) => `${short(d.day)} ${d.calls}`).join(", ")}`}>
      {days.map((d, i) => {
        const today = i === days.length - 1;
        return (
          <div key={d.day} className="group relative flex h-full flex-1 flex-col items-center justify-end gap-2">
            <span
              className={`pointer-events-none absolute z-10 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap tabular-nums ${today ? "bg-lime text-on-lime" : "hidden bg-accent text-on-accent group-hover:block"}`}
              style={{ bottom: `calc(${(d.calls / max) * 100}% * 0.8 + 1.75rem)` }}
            >
              {d.calls} {d.calls === 1 ? "call" : "calls"}
            </span>
            <div
              className={`w-full max-w-10 rounded-t-[10px] rounded-b-[4px] transition-opacity group-hover:opacity-80 ${today ? "bg-lime" : "hatch"}`}
              style={{ height: `calc(${Math.max(d.calls / max, 0.04) * 80}%)` }}
            />
            <span className={`text-[11px] ${today ? "font-semibold" : "text-muted"}`}>{short(d.day)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Minutes per day over 30 days: a hatched area under a 2px line, the latest day tagged in lime. */
export function MinutesArea({ days }: { days: Day[] }) {
  const W = 300;
  const H = 110;
  const max = Math.max(1, ...days.map((d) => d.minutes));
  const x = (i: number) => (i / Math.max(1, days.length - 1)) * W;
  const y = (v: number) => H - 8 - (v / max) * (H - 24);
  const line = days.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.minutes).toFixed(1)}`).join("");
  const last = days[days.length - 1];
  const step = W / Math.max(1, days.length - 1);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-36 w-full overflow-visible" preserveAspectRatio="none" role="img" aria-label={`Minutes per day over the last ${days.length} days`}>
        <defs>
          <pattern id="minutes-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--series-1)" strokeWidth="1.2" opacity="0.45" />
          </pattern>
        </defs>
        <line x1="0" x2={W} y1={H - 8} y2={H - 8} stroke="var(--grid)" />
        <path d={`${line}L${W},${H - 8}L0,${H - 8}Z`} fill="url(#minutes-hatch)" />
        <path d={line} fill="none" stroke="var(--series-1)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {days.map((d, i) => (
          <g key={d.day} className="group">
            <rect x={x(i) - step / 2} y="0" width={step} height={H} fill="transparent" />
            <line x1={x(i)} x2={x(i)} y1="0" y2={H - 8} stroke="var(--muted)" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" className="opacity-0 group-hover:opacity-100" />
            <title>{`${long(d.day)}: ${d.minutes} min`}</title>
          </g>
        ))}
      </svg>
      {last && (
        <>
          <span className="pointer-events-none absolute right-0 h-3 w-3 translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-lime" style={{ top: `${(y(last.minutes) / H) * 100}%` }} />
          <span className="pointer-events-none absolute right-2 -translate-y-[160%] rounded-full bg-lime px-2 py-0.5 text-xs font-semibold text-on-lime tabular-nums" style={{ top: `${(y(last.minutes) / H) * 100}%` }}>
            {last.minutes} min today
          </span>
        </>
      )}
      <div className="mt-1 flex justify-between text-[11px] text-muted">
        <span>{days[0] && long(days[0].day)}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

/** Up or down against the same point last month, as a small chip. */
export function Delta({ now, before }: { now: number; before: number }) {
  if (before === 0) return now > 0 ? <span className="badge border-transparent bg-lime text-on-lime">New</span> : null;
  const pct = Math.round(((now - before) / before) * 100);
  return (
    <span className={`badge ${pct >= 0 ? "border-transparent bg-lime text-on-lime" : ""}`} title="Compared with the same days last month">
      {pct >= 0 ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

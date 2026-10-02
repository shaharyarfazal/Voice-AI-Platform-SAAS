"use client";

import { useState } from "react";

type Point = { hour: string; calls: number };

const hourLabel = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric" });

/** Calls per hour, last 24 hours. One series, so the title names it and there is no legend. */
export function HourlyChart({ data }: { data: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.calls));
  const ticks = [max, Math.round(max / 2), 0].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <figure className="card">
      <figcaption className="mb-4 flex items-baseline justify-between">
        <span className="font-medium">Calls per hour</span>
        <span className="text-xs text-muted">last 24 hours</span>
      </figcaption>
      <div className="flex gap-2">
        <div className="relative flex h-40 w-8 flex-col justify-between text-right text-xs tabular-nums text-muted">
          {ticks.map((t) => (
            <span key={t} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">{t}</span>
          ))}
        </div>
        <div className="relative flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-grid" />
          <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-grid" />
          <div className="relative flex h-40 items-end gap-[2px] border-b border-muted/40" onMouseLeave={() => setHover(null)}>
            {data.map((d, i) => (
              <div
                key={d.hour}
                className="relative flex h-full flex-1 items-end justify-center"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                tabIndex={0}
                aria-label={`${hourLabel(d.hour)}: ${d.calls} calls`}
              >
                <div
                  className={`w-full max-w-[24px] rounded-t-[4px] bg-series-1 transition-opacity ${hover !== null && hover !== i ? "opacity-50" : ""}`}
                  style={{ height: d.calls === 0 ? 0 : `max(2px, ${(d.calls / max) * 100}%)` }}
                />
                {hover === i && (
                  <div
                    className={`pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md border border-border bg-background px-2 py-1 text-xs shadow ${
                      i >= data.length - 3 ? "right-0" : i < 3 ? "left-0" : "left-1/2 -translate-x-1/2"
                    }`}
                  >
                    <div className="text-muted">{hourLabel(d.hour)}</div>
                    <div className="font-semibold tabular-nums">{d.calls} call{d.calls === 1 ? "" : "s"}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-1 flex text-xs text-muted">
            {data.map((d, i) => (
              <span key={d.hour} className="relative flex-1">
                {i % 6 === 0 && <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap">{hourLabel(d.hour)}</span>}
              </span>
            ))}
          </div>
          <div className="h-4" />
        </div>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted">Show as table</summary>
        <table className="table mt-2">
          <thead><tr><th>Hour</th><th>Calls</th></tr></thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.hour}><td>{hourLabel(d.hour)}</td><td className="tabular-nums">{d.calls}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

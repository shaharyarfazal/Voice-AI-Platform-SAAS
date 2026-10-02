"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Metrics } from "@/lib/admin-metrics";
import { formatBytes, formatDuration, formatMoney, formatUptime } from "@/lib/format";
import { HourlyChart } from "./hourly-chart";
import { Stat, Status } from "./status";

const REFRESH_MS = 5000;

function Meter({ label, used, total, percent }: { label: string; used?: string; total?: string; percent: number | null }) {
  const p = percent ?? 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted">
          {percent === null ? "n/a" : `${p.toFixed(0)}%`}
          {used && total && ` · ${used} of ${total}`}
        </span>
      </div>
      <div className="h-2 rounded-full bg-grid">
        <div
          className={`h-2 rounded-full ${p >= 90 ? "bg-critical" : "bg-series-1"}`}
          style={{ width: `${Math.min(100, p)}%` }}
        />
      </div>
      {p >= 90 && <div className="mt-1 text-xs text-critical">▲ <span className="text-foreground">Over 90%</span></div>}
    </div>
  );
}

export function LiveDashboard({ initial }: { initial: Metrics }) {
  const [m, setM] = useState(initial);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/admin/metrics", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        if (!stopped) {
          setM(await res.json());
          setStale(false);
        }
      } catch {
        if (!stopped) setStale(true);
      }
    };
    const id = setInterval(tick, REFRESH_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  const { server, business: b } = m;
  const down = m.services.filter((s) => !s.ok);
  const pct = (x: { used: number; total: number } | null) => (x && x.total ? (x.used / x.total) * 100 : null);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Platform overview</h1>
        <span className="text-xs text-muted">
          {stale ? "▲ Can't reach the server, showing last data" : "● Live, updates every 5 seconds"} ·{" "}
          {new Date(m.at).toLocaleTimeString()}
        </span>
      </div>

      {down.length > 0 && (
        <div className="rounded-lg border border-critical/40 bg-critical/5 p-4 text-sm">
          <Status ok={false} label={`${down.length} service${down.length === 1 ? " is" : "s are"} down: ${down.map((s) => s.name).join(", ")}`} />
          <p className="mt-1 text-muted">See System for details and restart commands.</p>
        </div>
      )}

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Live calls now" value={m.liveCalls.length} />
        <Stat
          label="Calls today"
          value={b.today.calls}
          sub={`${b.today.minutes} min · ${b.today.errors} failed · ${b.today.avgLatencyMs == null ? "no response data" : `${(b.today.avgLatencyMs / 1000).toFixed(1)} s avg response`}`}
        />
        <Stat label="Minutes this month" value={b.month.minutes.toLocaleString()} sub={`${b.month.calls} calls`} />
        <Stat label="Clients" value={b.tenants.active} sub={`${b.tenants.total - b.tenants.active} suspended`} />
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">This month</h2>
          <Link href="/admin/billing" className="text-sm underline">Billing details</Link>
        </div>
        {!b.ratesConfigured && (
          <p className="mb-3 rounded-md border border-border p-3 text-sm text-muted">
            Costs show $0 until you enter your provider rates in <Link className="underline" href="/admin/settings">Settings</Link>.
          </p>
        )}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Revenue" value={formatMoney(b.month.revenue)} sub="monthly fees + per-minute usage" />
          <Stat label="AI and phone costs" value={formatMoney(b.month.providerCost)} sub="estimated from usage" />
          <Stat label="Server cost" value={formatMoney(b.month.serverCost)} sub="from Settings" />
          <Stat
            label="Profit"
            value={<span className={b.month.profit < 0 ? "text-critical" : ""}>{formatMoney(b.month.profit)}</span>}
            sub="revenue − all costs"
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <HourlyChart data={b.hourly} />
        <section className="card space-y-4">
          <div className="flex items-baseline justify-between">
            <span className="font-medium">Server</span>
            <span className="text-xs text-muted">up {formatUptime(server.uptimeSeconds)} · load {server.load.join(" / ")}</span>
          </div>
          <Meter label={`CPU (${server.cores} cores)`} percent={server.cpuPercent} />
          <Meter
            label="Memory"
            percent={pct(server.memory)}
            used={formatBytes(server.memory.used)}
            total={formatBytes(server.memory.total)}
          />
          <Meter
            label="Disk"
            percent={pct(server.disk)}
            used={server.disk ? formatBytes(server.disk.used) : undefined}
            total={server.disk ? formatBytes(server.disk.total) : undefined}
          />
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-lg font-semibold">Services</h2>
          <ul className="card divide-y divide-border p-0">
            {m.services.map((s) => (
              <li key={s.name} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="text-sm">{s.name}</span>
                <span className="flex items-center gap-3">
                  <span className="text-xs text-muted">{s.detail}</span>
                  <Status ok={s.ok} />
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="mb-3 text-lg font-semibold">Live calls</h2>
          {m.liveCalls.length === 0 ? (
            <p className="card text-sm text-muted">No calls in progress.</p>
          ) : (
            <div className="card overflow-x-auto p-0">
              <table className="table">
                <thead>
                  <tr><th className="pl-4">Client</th><th>Agent</th><th>Channel</th><th>From</th><th>Time</th></tr>
                </thead>
                <tbody>
                  {m.liveCalls.map((c) => (
                    <tr key={c.roomName}>
                      <td className="pl-4">{c.tenantName ?? "Connecting…"}</td>
                      <td>{c.agentName ?? "—"}</td>
                      <td>{c.channel}</td>
                      <td>{c.fromNumber ?? "—"}</td>
                      <td className="tabular-nums">{formatDuration(c.durationSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

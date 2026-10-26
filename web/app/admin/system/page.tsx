import { redisInfo, serverMetrics, services } from "@/lib/admin-metrics";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { formatBytes, formatUptime } from "@/lib/format";
import { cloudConfigured, getMediaServer } from "@/lib/media-server";
import { Status } from "../status";
import { runTranscriptPurge, switchMediaServer } from "./actions";

const COMMANDS: [string, string][] = [
  ["See what's running", "cd ~/voice/infra && docker compose ps"],
  ["Live logs of the voice agent", "docker compose logs -f agent"],
  ["Restart one service", "docker compose restart agent   # or web, livekit, sip, postgres, redis"],
  ["Restart everything", "docker compose restart"],
  ["Update to the latest code", "cd ~/voice && git pull && cd infra && docker compose up -d --build"],
  ["Back up the database now", "docker compose exec -T postgres pg_dump -U voice voice | gzip > ~/backup-$(date +%F).sql.gz"],
  ["Open a database shell", "docker compose exec postgres psql -U voice voice"],
];

export default async function SystemPage() {
  await requireAdmin();
  const [svc, server, red, [db], tables, [purge], mediaServer] = await Promise.all([
    services(),
    serverMetrics(),
    redisInfo(),
    sql`SELECT pg_database_size(current_database())::bigint AS size, version() AS version,
          (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS connections`,
    sql`SELECT relname AS name, n_live_tup::bigint AS rows, pg_total_relation_size(relid)::bigint AS size
        FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC`,
    sql`SELECT count(*)::int AS pending FROM calls c JOIN tenants t ON t.id = c.tenant_id
        WHERE c.transcript_purged_at IS NULL AND c.ended_at < now() - make_interval(days => t.transcript_retention_days)`,
    getMediaServer(),
  ]);
  const onCloud = mediaServer === "cloud";
  const canUseCloud = cloudConfigured();

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">System</h1>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Services</h2>
        <ul className="card divide-y divide-border p-0">
          {svc.services.map((s) => (
            <li key={s.name} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span className="text-sm">{s.name}</span>
              <span className="flex items-center gap-3"><span className="text-xs text-muted">{s.detail}</span><Status ok={s.ok} /></span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">
          Services are restarted from the server, not from this page: giving the dashboard control of Docker would let anyone who
          breaks into it take over the whole server. Use the commands below over SSH.
        </p>
      </section>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-medium">Media server for browser calls</h2>
            <p className="text-sm text-muted">
              Now using <strong className="text-foreground">{onCloud ? "LiveKit Cloud" : "this VPS"}</strong>. Applies to dashboard test
              calls and website widgets from the next call; calls in progress stay where they are. Phone calls always use this VPS.
            </p>
          </div>
          <form action={switchMediaServer} className="flex items-center gap-3 text-sm">
            <input type="hidden" name="target" value={onCloud ? "self-hosted" : "cloud"} />
            <span className={onCloud ? "text-muted" : "font-medium"}>VPS</span>
            <button
              role="switch"
              aria-checked={onCloud}
              aria-label="Use LiveKit Cloud for browser calls"
              disabled={!onCloud && !canUseCloud}
              className={`relative h-6 w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${onCloud ? "bg-foreground" : "bg-black/20 dark:bg-white/20"}`}
            >
              <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-background shadow transition-transform ${onCloud ? "translate-x-5" : ""}`} />
            </button>
            <span className={onCloud ? "font-medium" : "text-muted"}>LiveKit Cloud</span>
          </form>
        </div>
        {!canUseCloud && (
          <p className="text-xs text-muted">
            To use LiveKit Cloud, add LIVEKIT_CLOUD_URL, LIVEKIT_CLOUD_API_KEY and LIVEKIT_CLOUD_API_SECRET to infra/.env, add
            &quot;cloud&quot; to COMPOSE_PROFILES, then run docker compose up -d.
          </p>
        )}
        {onCloud && (
          <p className="text-xs text-muted">Calls on LiveKit Cloud don&apos;t appear in the live call view on the Overview page.</p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card space-y-2 text-sm">
          <h2 className="font-medium">Server</h2>
          <div className="flex justify-between"><span className="text-muted">CPU</span><span>{server.cpuPercent ?? "n/a"}% of {server.cores} cores</span></div>
          <div className="flex justify-between"><span className="text-muted">Load (1/5/15 min)</span><span>{server.load.join(" / ")}</span></div>
          <div className="flex justify-between"><span className="text-muted">Memory</span><span>{formatBytes(server.memory.used)} of {formatBytes(server.memory.total)}</span></div>
          {server.disk && <div className="flex justify-between"><span className="text-muted">Disk</span><span>{formatBytes(server.disk.used)} of {formatBytes(server.disk.total)}</span></div>}
          <div className="flex justify-between"><span className="text-muted">Uptime</span><span>{formatUptime(server.uptimeSeconds)}</span></div>
          <div className="flex justify-between"><span className="text-muted">Redis</span><span>{red.ok ? red.detail : `Down: ${red.detail}`}</span></div>
        </section>
        <section className="card space-y-2 text-sm">
          <h2 className="font-medium">Database</h2>
          <div className="flex justify-between"><span className="text-muted">Size</span><span>{formatBytes(Number(db.size))}</span></div>
          <div className="flex justify-between"><span className="text-muted">Open connections</span><span>{db.connections}</span></div>
          <div className="text-xs text-muted">{String(db.version).split(" on ")[0]}</div>
          <table className="table mt-2">
            <thead><tr><th>Table</th><th>Rows (approx.)</th><th>Size</th></tr></thead>
            <tbody>
              {tables.map((t) => (
                <tr key={t.name}><td>{t.name}</td><td className="tabular-nums">{Number(t.rows).toLocaleString()}</td><td>{formatBytes(Number(t.size))}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="card space-y-3">
        <h2 className="font-medium">Data retention</h2>
        <p className="text-sm text-muted">
          Transcripts are deleted automatically every hour once they pass each client&apos;s retention period (set per client).
          Call records, durations and usage are kept for billing. {purge.pending} transcript{purge.pending === 1 ? " is" : "s are"} due for deletion now.
        </p>
        <form action={runTranscriptPurge}><button className="btn-secondary">Run deletion now</button></form>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Server commands</h2>
        <div className="card space-y-3 text-sm">
          {COMMANDS.map(([label, cmd]) => (
            <div key={label}>
              <div className="text-muted">{label}</div>
              <code className="mt-1 block overflow-x-auto rounded bg-black/5 px-3 py-2 font-mono text-xs dark:bg-white/10">{cmd}</code>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

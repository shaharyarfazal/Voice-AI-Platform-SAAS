import "server-only";
import { readFile, statfs } from "node:fs/promises";
import os from "node:os";
import Redis from "ioredis";
import { RoomServiceClient } from "livekit-server-sdk";
import { sql } from "./db";
import { callCostSql, getSettings, ratesConfigured } from "./settings";

// The web container runs on the host network without its own PID/proc limits, so /proc and the
// root filesystem describe the whole server.

type CpuSample = { idle: number; total: number };

async function readCpu(): Promise<CpuSample> {
  const line = (await readFile("/proc/stat", "utf8")).split("\n")[0];
  const fields = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = fields[3] + (fields[4] ?? 0);
  return { idle, total: fields.reduce((a, b) => a + b, 0) };
}

declare global {
  var __cpuSample: CpuSample | undefined;
  var __redis: Redis | undefined;
}

async function cpuPercent(): Promise<number | null> {
  try {
    let prev = globalThis.__cpuSample;
    if (!prev) {
      prev = await readCpu();
      await new Promise((r) => setTimeout(r, 250));
    }
    const now = await readCpu();
    globalThis.__cpuSample = now;
    const total = now.total - prev.total;
    return total > 0 ? Math.round((1 - (now.idle - prev.idle) / total) * 1000) / 10 : null;
  } catch {
    return null;
  }
}

async function memory() {
  try {
    const info = await readFile("/proc/meminfo", "utf8");
    const kb = (key: string) => Number(info.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"))?.[1] ?? 0) * 1024;
    const total = kb("MemTotal");
    return { total, used: total - kb("MemAvailable") };
  } catch {
    return { total: os.totalmem(), used: os.totalmem() - os.freemem() };
  }
}

async function disk() {
  try {
    const s = await statfs("/");
    const total = s.blocks * s.bsize;
    return { total, used: total - s.bavail * s.bsize };
  } catch {
    return null;
  }
}

export type ServiceStatus = { name: string; ok: boolean; detail: string };

async function probe(name: string, url: string, describe?: (body: string) => string): Promise<ServiceStatus> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500), cache: "no-store" });
    const body = await res.text();
    return { name, ok: res.ok, detail: res.ok ? (describe ? describe(body) : "Healthy") : `HTTP ${res.status}: ${body.slice(0, 80)}` };
  } catch (e) {
    return { name, ok: false, detail: e instanceof Error ? e.message : "Unreachable" };
  }
}

function redis(): Redis {
  globalThis.__redis ??= new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 1500,
    enableOfflineQueue: false,
  });
  return globalThis.__redis;
}

export async function redisInfo(): Promise<{ ok: boolean; detail: string; usedMemory?: string; clients?: number }> {
  try {
    const client = redis();
    if (client.status === "wait" || client.status === "end") await client.connect();
    const info = await client.info();
    const get = (k: string) => info.match(new RegExp(`^${k}:(.*)$`, "m"))?.[1]?.trim();
    return {
      ok: true,
      detail: `${get("used_memory_human")} used, ${get("connected_clients")} clients`,
      usedMemory: get("used_memory_human"),
      clients: Number(get("connected_clients")),
    };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "Unreachable" };
  }
}

const livekitUrl = () => process.env.LIVEKIT_HTTP_URL ?? "http://127.0.0.1:7880";

export async function services(): Promise<{ services: ServiceStatus[]; agentJobs: number | null }> {
  let agentJobs: number | null = null;
  const [db, red, livekit, sip, agent] = await Promise.all([
    sql`SELECT 1`.then(
      () => ({ name: "Database (Postgres)", ok: true, detail: "Healthy" }),
      (e: Error) => ({ name: "Database (Postgres)", ok: false, detail: e.message }),
    ),
    redisInfo(),
    probe("Media server (LiveKit)", livekitUrl()),
    probe("Phone gateway (LiveKit SIP)", process.env.SIP_HEALTH_URL ?? "http://127.0.0.1:8091", (b) => b.trim() || "Healthy"),
    probe("Voice agent", (process.env.AGENT_HEALTH_URL ?? "http://127.0.0.1:8081") + "/worker", (b) => {
      try {
        const w = JSON.parse(b);
        agentJobs = Number(w.active_jobs ?? 0);
        return `${agentJobs} active call${agentJobs === 1 ? "" : "s"}, load ${Math.round(Number(w.worker_load ?? 0) * 100)}%`;
      } catch {
        return "Healthy";
      }
    }),
  ]);
  return {
    services: [
      { name: "Dashboard and API", ok: true, detail: "Healthy" },
      db,
      { name: "Cache (Redis)", ok: red.ok, detail: red.detail },
      livekit,
      sip,
      agent,
    ],
    agentJobs,
  };
}

export type LiveCall = {
  roomName: string;
  channel: string;
  tenantName: string | null;
  agentName: string | null;
  fromNumber: string | null;
  durationSeconds: number;
};

export async function liveCalls(): Promise<LiveCall[]> {
  let rooms: { name: string; creationTime: bigint; numParticipants: number }[] = [];
  try {
    const client = new RoomServiceClient(livekitUrl(), process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
    rooms = await client.listRooms();
  } catch {
    return [];
  }
  const names = rooms.map((r) => r.name);
  // Calls whose room is gone (agent crashed before reporting) are cleared after a grace period.
  await sql`DELETE FROM live_calls WHERE started_at < now() - interval '2 minutes' AND NOT (room_name = ANY(${names}))`;
  if (names.length === 0) return [];
  const known = await sql<{ room_name: string; tenant_name: string; agent_name: string | null; from_number: string | null }[]>`
    SELECT l.room_name, t.name AS tenant_name, a.name AS agent_name, l.from_number
    FROM live_calls l JOIN tenants t ON t.id = l.tenant_id LEFT JOIN agents a ON a.id = l.agent_id
    WHERE l.room_name = ANY(${names})`;
  const byRoom = new Map(known.map((k) => [k.room_name, k]));
  const now = Date.now() / 1000;
  return rooms
    .filter((r) => r.name.startsWith("call-") || r.name.startsWith("web-"))
    .map((r) => {
      const k = byRoom.get(r.name);
      return {
        roomName: r.name,
        channel: r.name.startsWith("call-") ? "phone" : "web",
        tenantName: k?.tenant_name ?? null,
        agentName: k?.agent_name ?? null,
        fromNumber: k?.from_number ?? null,
        durationSeconds: Math.max(0, Math.round(now - Number(r.creationTime))),
      };
    })
    .sort((a, b) => b.durationSeconds - a.durationSeconds);
}

export async function businessMetrics() {
  const settings = await getSettings();
  const cost = callCostSql(settings.rates);
  const [today] = await sql`
    SELECT count(*)::int AS calls, coalesce(sum(duration_seconds), 0)::int AS seconds,
           count(*) FILTER (WHERE outcome = 'error')::int AS errors
    FROM calls c WHERE started_at >= date_trunc('day', now())`;
  const [month] = await sql`
    SELECT count(*)::int AS calls, coalesce(sum(c.duration_seconds), 0)::int AS seconds,
           coalesce(sum(${cost}), 0)::float AS provider_cost,
           coalesce(sum(c.duration_seconds / 60.0 * t.price_per_minute), 0)::float AS usage_revenue
    FROM calls c JOIN tenants t ON t.id = c.tenant_id WHERE c.started_at >= date_trunc('month', now())`;
  const [tenants] = await sql`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'active')::int AS active,
           coalesce(sum(monthly_fee) FILTER (WHERE status = 'active'), 0)::float AS fees
    FROM tenants`;
  const hourly = await sql<{ hour: Date; calls: number }[]>`
    SELECT h.hour, count(c.id)::int AS calls
    FROM generate_series(date_trunc('hour', now()) - interval '23 hours', date_trunc('hour', now()), interval '1 hour') AS h(hour)
    LEFT JOIN calls c ON c.started_at >= h.hour AND c.started_at < h.hour + interval '1 hour'
    GROUP BY h.hour ORDER BY h.hour`;

  const revenue = tenants.fees + month.usage_revenue;
  const totalCost = month.provider_cost + settings.rates.serverMonthly;
  return {
    today: { calls: today.calls, minutes: Math.round(today.seconds / 60), errors: today.errors },
    month: {
      calls: month.calls,
      minutes: Math.round(month.seconds / 60),
      revenue,
      providerCost: month.provider_cost,
      serverCost: settings.rates.serverMonthly,
      profit: revenue - totalCost,
    },
    tenants: { total: tenants.total, active: tenants.active },
    ratesConfigured: ratesConfigured(settings.rates),
    hourly: hourly.map((h) => ({ hour: h.hour.toISOString(), calls: h.calls })),
  };
}

export async function serverMetrics() {
  const [cpu, mem, dsk] = await Promise.all([cpuPercent(), memory(), disk()]);
  return {
    cpuPercent: cpu,
    cores: os.cpus().length,
    load: os.loadavg().map((l) => Math.round(l * 100) / 100),
    memory: mem,
    disk: dsk,
    uptimeSeconds: Math.round(os.uptime()),
  };
}

export async function collectMetrics() {
  const [server, svc, calls, business] = await Promise.all([serverMetrics(), services(), liveCalls(), businessMetrics()]);
  return { at: new Date().toISOString(), server, services: svc.services, liveCalls: calls, business };
}

export type Metrics = Awaited<ReturnType<typeof collectMetrics>>;

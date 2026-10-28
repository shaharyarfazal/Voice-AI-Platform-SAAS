import Link from "next/link";
import { Icon } from "@/components/icons";
import { requireSession } from "@/lib/auth";
import { fromMilli, total } from "@/lib/billing/credits-math";
import { walletFor } from "@/lib/billing/wallet";
import { sql, type CallRow } from "@/lib/db";
import { CallTable } from "./calls/call-table";
import { Delta, MinutesArea, WeekBars, type Day } from "./overview-charts";

/** Glossy lime spheres for the hero card: decoration only. */
const SPHERES = [
  { size: 132, top: -18, right: -12 },
  { size: 84, top: 70, right: 104 },
  { size: 56, top: 12, right: 150 },
  { size: 40, top: 128, right: 40 },
];

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  const { tenantId } = await requireSession();
  const { welcome } = await searchParams;

  const [[stats], daily, recent, wallet] = await Promise.all([
    sql<{ agents: number; chatbots: number; numbers: number; widgets: number; kbs: number; calls: number; seconds: number; chats: number; calls_before: number }[]>`
      SELECT
        (SELECT count(*)::int FROM agents WHERE tenant_id = ${tenantId} AND type <> 'chat') AS agents,
        (SELECT count(*)::int FROM agents WHERE tenant_id = ${tenantId} AND type = 'chat') AS chatbots,
        (SELECT count(*)::int FROM phone_numbers WHERE tenant_id = ${tenantId}) AS numbers,
        (SELECT count(*)::int FROM widgets WHERE tenant_id = ${tenantId}) AS widgets,
        (SELECT count(*)::int FROM kb_sources WHERE tenant_id = ${tenantId} AND status = 'ready') AS kbs,
        (SELECT count(*)::int FROM chat_sessions WHERE tenant_id = ${tenantId} AND started_at >= date_trunc('month', now())) AS chats,
        (SELECT count(*)::int FROM calls WHERE tenant_id = ${tenantId}
          AND started_at >= date_trunc('month', now()) - interval '1 month' AND started_at < now() - interval '1 month') AS calls_before,
        count(*)::int AS calls,
        coalesce(sum(duration_seconds), 0)::int AS seconds
      FROM calls WHERE tenant_id = ${tenantId} AND started_at >= date_trunc('month', now())`,
    // One row per day for the last 30 days (UTC), including days without calls.
    sql<Day[]>`
      SELECT to_char(d, 'YYYY-MM-DD') AS day, count(c.id)::int AS calls, ceil(coalesce(sum(c.duration_seconds), 0) / 60.0)::int AS minutes
      FROM generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d
      LEFT JOIN calls c ON c.tenant_id = ${tenantId} AND c.started_at >= d AND c.started_at < d + interval '1 day'
      GROUP BY d ORDER BY d`,
    sql<CallRow[]>`
      SELECT c.*, a.name AS agent_name FROM calls c LEFT JOIN agents a ON a.id = c.agent_id
      WHERE c.tenant_id = ${tenantId} ORDER BY c.started_at DESC LIMIT 10`,
    walletFor(tenantId),
  ]);

  const week = daily.slice(-7);
  const weekCalls = week.reduce((n, d) => n + d.calls, 0);
  const monthMinutes = daily.reduce((n, d) => n + d.minutes, 0);
  const minutesThisMonth = Math.ceil(stats.seconds / 60);
  const balance = wallet && wallet.mode !== "manual" ? fromMilli(total(wallet.balances)) : null;
  const now = new Date();
  const monthRange = `${new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  const steps = [
    { done: stats.agents + stats.chatbots > 0, title: "Create your agents", body: "A receptionist, an outbound caller and a chatbot.", href: "/agents", cta: "Open agents" },
    { done: stats.kbs > 0, title: "Teach them about your business", body: "Add your website or documents to the knowledge base.", href: "/knowledge", cta: "Add knowledge" },
    { done: false, title: "Try a test call", body: "Talk to your receptionist from the browser.", href: "/agents", cta: "Test now" },
    { done: stats.numbers > 0, title: "Connect a phone number", body: "Calls to it are answered by your agent.", href: "/numbers", cta: "Add number" },
    { done: stats.widgets > 0, title: "Put the chatbot on your website", body: "One line of code: chat, click-to-call, or both.", href: "/widgets/new", cta: "Create widget" },
  ];
  const remaining = steps.filter((s) => !s.done).length;
  const setup = [
    { label: "Voice agents", value: stats.agents, href: "/agents" },
    { label: "Chatbots", value: stats.chatbots, href: "/chatbots" },
    { label: "Phone numbers", value: stats.numbers, href: "/numbers" },
    { label: "Widgets", value: stats.widgets, href: "/widgets" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Workspace <span aria-hidden>/</span> Overview</p>
          <h1 className="page-title mt-1">{welcome ? "You're all set up" : "Call performance"}</h1>
          {welcome && <p className="page-sub">Your agents are ready. Here&apos;s how to get them working for you.</p>}
        </div>
        <div className="flex items-center gap-2">
          <span className="btn-secondary cursor-default py-2 pl-2" title="Figures cover this month">
            <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-full bg-lime text-on-lime"><Icon name="calendar" className="h-4 w-4" /></span>
            {monthRange}
          </span>
          <Link className="btn md:hidden" href="/agents/new"><Icon name="plus" /> New agent</Link>
        </div>
      </div>

      {(welcome || remaining > 1) && (
        <section className="card" aria-label="Getting started">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-medium">Getting started</h2>
            <span className="text-sm text-muted">{steps.length - remaining} of {steps.length} done</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface">
            <div className="h-full rounded-full bg-lime" style={{ width: `${((steps.length - remaining) / steps.length) * 100}%` }} />
          </div>
          <ol className="mt-2 divide-y divide-border">
            {steps.map((s, i) => (
              <li key={i} className="flex flex-wrap items-center gap-3 py-3">
                <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${s.done ? "bg-lime text-on-lime" : "border border-border text-muted"}`}>{s.done ? "✓" : i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-medium ${s.done ? "text-muted line-through" : ""}`}>{s.title}</div>
                  <div className="text-sm text-muted">{s.body}</div>
                </div>
                {!s.done && <Link href={s.href} className="btn-secondary py-1.5">{s.cta}</Link>}
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-12 lg:grid-rows-[auto_auto]">
        {/* Hero: this month's calls, on the dark card. */}
        <section className="relative flex min-h-[22rem] flex-col justify-between overflow-hidden rounded-3xl bg-[#141513] p-6 text-white shadow-soft lg:col-span-4 lg:row-span-2" aria-label="This month">
          <div aria-hidden>
            {SPHERES.map((s, i) => (
              <span
                key={i}
                className="absolute rounded-full"
                style={{
                  width: s.size, height: s.size, top: s.top, right: s.right,
                  background: "radial-gradient(circle at 32% 28%, #f6ffd0 0%, #d4f24a 28%, #9bbf12 70%, #4f6300 100%)",
                  boxShadow: "0 18px 40px -12px rgb(212 242 74 / 0.45)",
                }}
              />
            ))}
          </div>
          <div className="relative">
            <span className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/80">This month</span>
          </div>
          <div className="relative mt-24 rounded-2xl border border-white/15 bg-white/10 p-5 backdrop-blur-md">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm text-white/70">Calls answered</div>
                <div className="mt-1 text-5xl font-light tracking-tight tabular-nums">{stats.calls.toLocaleString("en-US")}</div>
              </div>
              <Delta now={stats.calls} before={stats.calls_before} />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-white/10 p-3">
                <div className="text-xl font-light tabular-nums">{minutesThisMonth.toLocaleString("en-US")}</div>
                <div className="text-xs text-white/70">Minutes talked</div>
              </div>
              <div className="rounded-xl bg-white/10 p-3">
                <div className="text-xl font-light tabular-nums">{stats.chats.toLocaleString("en-US")}</div>
                <div className="text-xs text-white/70">Website chats</div>
              </div>
            </div>
          </div>
        </section>

        <section className="card lg:col-span-4" aria-label="Activity">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-sm font-medium">Activity</h2>
              <div className="metric mt-2">{weekCalls}</div>
              <div className="text-sm text-muted">Calls in the last 7 days</div>
            </div>
            <Link href="/calls" className="icon-btn" aria-label="All calls"><Icon name="arrow" /></Link>
          </div>
          <div className="mt-4"><WeekBars days={week} /></div>
        </section>

        <section className="card lg:col-span-4" aria-label="Minutes">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-sm font-medium">Talk time</h2>
              <div className="metric mt-2">{monthMinutes.toLocaleString("en-US")}<span className="ml-1 text-lg text-muted">min</span></div>
              <div className="text-sm text-muted">Last 30 days</div>
            </div>
            <Link href="/calls" className="icon-btn" aria-label="Call history"><Icon name="arrow" /></Link>
          </div>
          <div className="mt-4"><MinutesArea days={daily} /></div>
        </section>

        <section className="card lg:col-span-5" aria-label="Credits">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-medium">Credits</h2>
              <div className="metric mt-2">{balance === null ? "—" : balance.toLocaleString("en-US", { maximumFractionDigits: 0 })}</div>
              <div className="text-sm text-muted">{wallet ? `${wallet.creditsPerMinute} credits per call minute` : "Billing is handled for you"}</div>
            </div>
            <Link href="/billing" className="icon-btn" aria-label="Billing"><Icon name="arrow" /></Link>
          </div>
          {/* A wallet card, half tucked into the bottom of the card. */}
          <div aria-hidden className="relative mt-6 h-24 overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-36 rounded-2xl bg-[#141513] p-4 text-white">
              <div className="flex items-center justify-between">
                <span className="h-6 w-9 rounded-md bg-lime" />
                <span className="text-xs tracking-widest text-white/60">•••• CREDITS</span>
              </div>
              <div className="mt-4 text-lg font-light tracking-wide text-white/90 tabular-nums">
                {balance === null ? "Included" : `${balance.toLocaleString("en-US", { maximumFractionDigits: 0 })} cr`}
              </div>
            </div>
          </div>
        </section>

        <section className="card lg:col-span-3" aria-label="Your setup">
          <h2 className="text-sm font-medium">Your setup</h2>
          <ul className="mt-3 space-y-1">
            {setup.map((s) => (
              <li key={s.href}>
                <Link href={s.href} className="flex items-center justify-between rounded-xl px-2 py-2 transition hover:bg-surface">
                  <span className="text-sm text-muted">{s.label}</span>
                  <span className={`min-w-8 rounded-full px-2 py-0.5 text-center text-sm font-semibold tabular-nums ${s.value ? "bg-surface" : "bg-lime text-on-lime"}`}>{s.value}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium">Recent calls</h2>
          <Link href="/calls" className="btn-secondary py-1.5">All calls &amp; chats</Link>
        </div>
        {recent.length ? <CallTable calls={recent} /> : <p className="text-sm text-muted">No calls yet. Start a test call from any voice agent.</p>}
      </section>
    </div>
  );
}

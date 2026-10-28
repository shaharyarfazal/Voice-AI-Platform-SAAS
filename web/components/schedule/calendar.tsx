"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, staffColor } from "./api";
import { CreateJob, type Draft } from "./create-job";
import { JobDrawer } from "./job-drawer";
import { type Column, type DropTarget, TimeGrid } from "./time-grid";
import { addDays, atLocal, formatDay, formatTime, startOfWeek, today, zoned } from "./tz";
import type { CalendarData, CalendarEvent, Labels, Service } from "./types";

type View = "team" | "day" | "week" | "month";
const VIEWS: { key: View; label: string }[] = [
  { key: "team", label: "Team" },
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

function range(view: View, anchor: string): { first: string; days: number } {
  if (view === "week") return { first: startOfWeek(anchor), days: 7 };
  if (view === "month") return { first: startOfWeek(`${anchor.slice(0, 7)}-01`), days: 42 };
  return { first: anchor, days: 1 };
}

function step(view: View, anchor: string, dir: number): string {
  if (view === "week") return addDays(anchor, 7 * dir);
  if (view === "month") {
    const [y, m] = anchor.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + dir, 1));
    return d.toISOString().slice(0, 10);
  }
  return addDays(anchor, dir);
}

function title(view: View, anchor: string): string {
  if (view === "month") return formatDay(anchor, { month: "long", year: "numeric" });
  if (view === "week") {
    const first = startOfWeek(anchor);
    return `${formatDay(first, { month: "short", day: "numeric" })} – ${formatDay(addDays(first, 6), { month: "short", day: "numeric", year: "numeric" })}`;
  }
  return formatDay(anchor, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

export function ScheduleCalendar({ timezone, labels, services, canEdit }: { timezone: string; labels: Labels; services: Service[]; canEdit: boolean }) {
  const [view, setView] = useState<View>("team");
  const [anchor, setAnchor] = useState(() => today(timezone));
  const [data, setData] = useState<CalendarData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [version, setVersion] = useState(0);
  const tz = data?.timezone ?? timezone;
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    const { first, days } = range(view, anchor);
    const start = atLocal(first, 0, timezone).toISOString();
    const end = atLocal(addDays(first, days), 0, timezone).toISOString();
    const controller = new AbortController();
    api<CalendarData>(`calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, { signal: controller.signal })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => e.name !== "AbortError" && setError(e.message));
    return () => controller.abort();
  }, [view, anchor, timezone, version]);

  // Held slots disappear when callers finish or abandon them; keep the view current.
  useEffect(() => {
    const timer = setInterval(reload, 30_000);
    return () => clearInterval(timer);
  }, [reload]);

  const staff = useMemo(() => data?.staff.filter((s) => s.active || data.events.some((e) => e.staff_id === s.id)) ?? [], [data]);
  const colors = useMemo(() => new Map(staff.map((s, i) => [s.id, staffColor(s, i)])), [staff]);
  const visibleStaff = staff.filter((s) => !hidden.has(s.id));
  const events = (data?.events ?? []).filter((e) => !hidden.has(e.staff_id));
  const colorFor = (e: CalendarEvent) => colors.get(e.staff_id) ?? "var(--accent)";

  const { first, days } = range(view, anchor);
  const columns: Column[] =
    view === "team"
      ? visibleStaff.map((s) => ({
          key: s.id,
          day: anchor,
          staffId: s.id,
          label: (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: colors.get(s.id) }} />
              <span className="truncate">{s.name}</span>
            </span>
          ),
        }))
      : Array.from({ length: view === "week" ? 7 : 1 }, (_, i) => {
          const day = addDays(first, i);
          return { key: day, day, label: <span className={day === today(tz) ? "text-accent" : ""}>{formatDay(day)}</span> };
        });

  // Show 6 AM–9 PM, widened to fit anything booked outside it.
  const inRange = events.filter((e) => e.kind === "booking");
  const firstHour = Math.min(6, ...inRange.map((e) => zoned(new Date(e.start), tz).h));
  const lastHour = Math.max(21, ...inRange.map((e) => Math.min(24, zoned(new Date(e.end), tz).h + 1)));

  async function onDrop(target: DropTarget) {
    const start = atLocal(target.day, target.minutes, tz);
    const staffName = target.staffId ? staff.find((s) => s.id === target.staffId)?.first_name : null;
    setNotice(null);
    setData((d) =>
      d && {
        ...d,
        events: d.events.map((e) =>
          e.id === target.event.id
            ? {
                ...e,
                start: start.toISOString(),
                end: new Date(start.getTime() + (new Date(e.end).getTime() - new Date(e.start).getTime())).toISOString(),
                staff_id: target.staffId ?? e.staff_id,
              }
            : e,
        ),
      },
    );
    try {
      await api(`bookings/${target.event.id}`, {
        method: "PATCH",
        body: { version: target.event.version, start: start.toISOString(), ...(target.staffId ? { staff_id: target.staffId } : {}) },
      });
      setNotice(`Moved to ${formatDay(target.day)} ${formatTime(start, tz)}${staffName ? ` with ${staffName}` : ""}.`);
    } catch (e) {
      setNotice(`Couldn't move it: ${(e as Error).message}`);
    }
    reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border p-0.5" role="tablist" aria-label="Calendar view">
          {VIEWS.map((v) => (
            <button key={v.key} role="tab" aria-selected={view === v.key} onClick={() => setView(v.key)}
              className={`rounded px-3 py-1 text-sm ${view === v.key ? "bg-accent text-on-accent" : "text-muted hover:text-foreground"}`}>
              {v.key === "team" ? labels.staff_plural : v.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button className="btn-secondary px-2 py-1" onClick={() => setAnchor(step(view, anchor, -1))} aria-label="Previous">‹</button>
          <button className="btn-secondary px-3 py-1" onClick={() => setAnchor(today(tz))}>Today</button>
          <button className="btn-secondary px-2 py-1" onClick={() => setAnchor(step(view, anchor, 1))} aria-label="Next">›</button>
        </div>
        <h2 className="text-sm font-semibold">{title(view, anchor)}</h2>
        <span className="text-xs text-muted">{tz}</span>
        {canEdit && (
          <button className="btn ml-auto py-1.5" onClick={() => setDraft({ day: anchor, minutes: 9 * 60 })}>
            New {labels.booking.toLowerCase()}
          </button>
        )}
      </div>

      {staff.length > 1 && (
        <div className="flex flex-wrap gap-1.5" aria-label={`Show ${labels.staff_plural.toLowerCase()}`}>
          {staff.map((s) => (
            <button key={s.id} onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })}
              className={`badge ${hidden.has(s.id) ? "opacity-40" : ""}`} aria-pressed={!hidden.has(s.id)}>
              <span className="h-2 w-2 rounded-full" style={{ background: colors.get(s.id) }} />
              {s.name}
            </button>
          ))}
        </div>
      )}

      {error && <p className="card text-sm text-critical">{error}</p>}
      {notice && <p className="text-sm text-muted" role="status">{notice}</p>}

      {data && staff.length === 0 && (
        <p className="card text-sm text-muted">Add your {labels.staff_plural.toLowerCase()} and their working hours on the {labels.staff_plural} tab to start booking.</p>
      )}

      {data && staff.length > 0 && view !== "month" && (
        <TimeGrid
          columns={columns}
          events={events}
          tz={tz}
          granularity={data.slot_granularity_min}
          firstHour={firstHour}
          lastHour={lastHour}
          colorFor={colorFor}
          canEdit={canEdit}
          onEventClick={(e) => e.kind === "booking" && setSelected(e.id)}
          onSlotClick={(col, minutes) => setDraft({ day: col.day, minutes, staffId: col.staffId })}
          onDrop={onDrop}
        />
      )}

      {data && staff.length > 0 && view === "month" && (
        <MonthGrid first={first} days={days} anchor={anchor} tz={tz} events={events} colorFor={colorFor}
          onDay={(day) => { setAnchor(day); setView("team"); }} onEvent={(id) => setSelected(id)} />
      )}

      {selected && (
        <JobDrawer id={selected} labels={labels} canEdit={canEdit} onClose={() => setSelected(null)} onChanged={reload} />
      )}
      {draft && data && (
        <CreateJob draft={draft} tz={tz} services={services} staff={data.staff} labels={labels} onClose={() => setDraft(null)}
          onCreated={(job) => { setDraft(null); setSelected(job.id); reload(); }} />
      )}
    </div>
  );
}

function MonthGrid({ first, days, anchor, tz, events, colorFor, onDay, onEvent }: {
  first: string; days: number; anchor: string; tz: string; events: CalendarEvent[];
  colorFor: (e: CalendarEvent) => string; onDay: (day: string) => void; onEvent: (id: string) => void;
}) {
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    if (e.kind !== "booking") continue;
    const day = zoned(new Date(e.start), tz).day;
    byDay.set(day, [...(byDay.get(day) ?? []), e]);
  }
  const month = anchor.slice(0, 7);
  const now = today(tz);
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <div className="grid min-w-[640px] grid-cols-7">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="border-b border-border px-2 py-1.5 text-xs font-medium text-muted">{d}</div>
        ))}
        {Array.from({ length: days }, (_, i) => {
          const day = addDays(first, i);
          const list = (byDay.get(day) ?? []).sort((a, b) => a.start.localeCompare(b.start));
          return (
            <div key={day} className={`min-h-24 border-b border-l border-border p-1 first:border-l-0 ${day.slice(0, 7) !== month ? "bg-surface/60" : ""}`}>
              <button onClick={() => onDay(day)} className={`mb-1 rounded px-1 text-xs ${day === now ? "bg-accent text-on-accent" : "text-muted hover:text-foreground"}`}>
                {Number(day.slice(8))}
              </button>
              <div className="space-y-0.5">
                {list.slice(0, 3).map((e) => (
                  <button key={e.id} onClick={() => onEvent(e.id)} className="flex w-full items-center gap-1 truncate rounded px-1 text-left text-[11px] hover:bg-surface">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: colorFor(e) }} />
                    <span className="text-muted">{formatTime(new Date(e.start), tz).replace(":00", "")}</span>
                    <span className="truncate">{e.title}</span>
                  </button>
                ))}
                {list.length > 3 && (
                  <button onClick={() => onDay(day)} className="px-1 text-[11px] text-muted hover:text-foreground">+{list.length - 3} more</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

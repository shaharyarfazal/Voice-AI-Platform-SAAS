"use client";

import { useCallback, useEffect, useState } from "react";
import { api, PALETTE, staffColor } from "./api";
import { atLocal, formatDateTime } from "./tz";
import { CalendarConnections } from "./calendar-connections";
import type { Connections, Settings, Staff } from "./types";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
type Window = { weekday: number; start: string; end: string };
type TimeOff = { id: string; start: string; end: string; reason: string };

function splitList(value: FormDataEntryValue | null): string[] {
  return String(value || "").split(/[,\s]+/).map((v) => v.trim()).filter(Boolean);
}

function StaffFields({ staff, settings, color }: { staff?: Staff; settings: Settings; color: string }) {
  const known = new Set(settings.skills);
  const extra = (staff?.skills ?? []).filter((k) => !known.has(k));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label><span className="label">Name</span><input name="name" className="input" defaultValue={staff?.name} required maxLength={120} /></label>
      <label><span className="label">Mobile</span><input name="phone" type="tel" className="input" defaultValue={staff?.phone ?? ""} maxLength={40} /></label>
      <label><span className="label">Email</span><input name="email" type="email" className="input" defaultValue={staff?.email ?? ""} maxLength={200} /></label>
      <label>
        <span className="label">Calendar colour</span>
        <input name="color" type="color" className="h-9 w-16 rounded border border-border" defaultValue={color} />
      </label>
      {settings.skills.length > 0 && (
        <fieldset className="sm:col-span-2">
          <legend className="label">Skills</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {settings.skills.map((k) => (
              <label key={k} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="skill" value={k} defaultChecked={staff?.skills.includes(k)} className="h-4 w-4 accent-[var(--accent)]" />
                {k.replaceAll("_", " ")}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <label className="sm:col-span-2">
        <span className="label">Other skills</span>
        <input name="extra_skills" className="input" defaultValue={extra.join(", ")} placeholder="Comma separated" />
      </label>
      <label className="sm:col-span-2">
        <span className="label">Covers ZIP / postal codes</span>
        <input name="zones" className="input" defaultValue={staff?.zones.join(", ")} placeholder="Leave empty for the whole service area" />
      </label>
      <label>
        <span className="label">Max jobs per day</span>
        <input name="daily_job_cap" type="number" min={1} className="input" defaultValue={staff?.daily_job_cap ?? ""} placeholder="Business default" />
      </label>
      <label>
        <span className="label">Priority</span>
        <input name="priority" type="number" min={-100} max={100} className="input" defaultValue={staff?.priority ?? 0} />
        <span className="hint block">Breaks ties when several people are equally free.</span>
      </label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="active" defaultChecked={staff?.active ?? true} className="h-4 w-4 accent-[var(--accent)]" />
        Active (can be booked)
      </label>
    </div>
  );
}

function staffBody(f: FormData) {
  const cap = String(f.get("daily_job_cap") || "").trim();
  return {
    name: f.get("name"),
    phone: String(f.get("phone") || "").trim() || null,
    email: String(f.get("email") || "").trim() || null,
    color: f.get("color"),
    skills: [...new Set([...f.getAll("skill").map(String), ...splitList(f.get("extra_skills"))])],
    zones: splitList(f.get("zones")),
    daily_job_cap: cap ? Number(cap) : null,
    priority: Number(f.get("priority") || 0),
    active: f.get("active") === "on",
  };
}

function HoursEditor({ staff, canEdit, onSaved }: { staff: Staff; canEdit: boolean; onSaved: (s: Staff) => void }) {
  const [windows, setWindows] = useState<Window[]>(staff.working_hours ?? []);
  const [message, setMessage] = useState<string | null>(null);
  const update = (i: number, patch: Partial<Window>) => setWindows((w) => w.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function save() {
    setMessage(null);
    try {
      onSaved(await api<Staff>(`staff/${staff.id}/working-hours`, { method: "PUT", body: { windows } }));
      setMessage("Hours saved.");
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  function copyWeekdays() {
    const monday = windows.filter((w) => w.weekday === 0);
    setWindows([...windows.filter((w) => w.weekday > 4), ...[0, 1, 2, 3, 4].flatMap((d) => monday.map((w) => ({ ...w, weekday: d })))]);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Working hours</h4>
        {canEdit && <button type="button" className="text-xs text-accent underline" onClick={copyWeekdays}>Copy Monday to all weekdays</button>}
      </div>
      {DAYS.map((name, day) => {
        const rows = windows.map((w, i) => ({ w, i })).filter(({ w }) => w.weekday === day);
        return (
          <div key={day} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-24 text-muted">{name}</span>
            {rows.length === 0 && <span className="text-muted">Off</span>}
            {rows.map(({ w, i }) => (
              <span key={i} className="flex items-center gap-1">
                <input type="time" className="input w-28 py-1" value={w.start} disabled={!canEdit} onChange={(e) => update(i, { start: e.target.value })} aria-label={`${name} start`} />
                –
                <input type="time" className="input w-28 py-1" value={w.end === "24:00" ? "23:59" : w.end} disabled={!canEdit} onChange={(e) => update(i, { end: e.target.value })} aria-label={`${name} end`} />
                {canEdit && <button type="button" className="px-1 text-muted hover:text-critical" aria-label="Remove" onClick={() => setWindows((ws) => ws.filter((_, j) => j !== i))}>✕</button>}
              </span>
            ))}
            {canEdit && (
              <button type="button" className="text-xs text-accent underline"
                onClick={() => setWindows((ws) => [...ws, { weekday: day, start: rows.length ? "13:00" : "08:00", end: "17:00" }])}>
                + add
              </button>
            )}
          </div>
        );
      })}
      {canEdit && (
        <div className="flex items-center gap-3 pt-1">
          <button type="button" className="btn-secondary py-1.5" onClick={save}>Save hours</button>
          {message && <span className="text-sm text-muted" role="status">{message}</span>}
        </div>
      )}
    </div>
  );
}

function TimeOffEditor({ staff, tz, canEdit }: { staff: Staff; tz: string; canEdit: boolean }) {
  const [items, setItems] = useState<TimeOff[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setItems(await api<TimeOff[]>(`staff/${staff.id}/time-off`));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const toInstant = (v: string) => atLocal(v.slice(0, 10), Number(v.slice(11, 13)) * 60 + Number(v.slice(14, 16)), tz).toISOString();
    setError(null);
    try {
      const row = await api<TimeOff>(`staff/${staff.id}/time-off`, {
        body: { start: toInstant(String(f.get("start"))), end: toInstant(String(f.get("end"))), reason: f.get("reason") || "" },
      });
      setItems((list) => [...(list ?? []), row].sort((a, b) => a.start.localeCompare(b.start)));
      form.reset();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    try {
      await api(`staff/${staff.id}/time-off/${id}`, { method: "DELETE" });
      setItems((list) => (list ?? []).filter((t) => t.id !== id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (items === null) {
    return <button type="button" className="text-sm text-accent underline" onClick={load}>Show time off</button>;
  }
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">Time off <span className="font-normal text-muted">({tz})</span></h4>
      {items.length === 0 && <p className="text-sm text-muted">None scheduled.</p>}
      <ul className="space-y-1 text-sm">
        {items.map((t) => (
          <li key={t.id} className="flex items-center gap-2">
            {formatDateTime(new Date(t.start), tz)} → {formatDateTime(new Date(t.end), tz)}
            {t.reason && <span className="text-muted">· {t.reason}</span>}
            {canEdit && <button type="button" className="text-muted hover:text-critical" onClick={() => remove(t.id)} aria-label="Delete time off">✕</button>}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <label><span className="label text-xs">From</span><input name="start" type="datetime-local" className="input py-1" required /></label>
          <label><span className="label text-xs">To</span><input name="end" type="datetime-local" className="input py-1" required /></label>
          <label><span className="label text-xs">Reason</span><input name="reason" className="input py-1" maxLength={300} /></label>
          <button className="btn-secondary py-1.5">Add</button>
        </form>
      )}
      {error && <p className="text-sm text-critical">{error}</p>}
    </div>
  );
}

export function TeamEditor({ initial, settings, canEdit, notice }: { initial: Staff[]; settings: Settings; canEdit: boolean; notice?: { ok: boolean; text: string } }) {
  const [staff, setStaff] = useState(initial);
  const [connections, setConnections] = useState<Connections | null>(null);
  const loadConnections = useCallback(() => {
    api<Connections>("connections").then(setConnections).catch(() => setConnections({ providers: [], accounts: [], failures: [] }));
  }, []);
  useEffect(loadConnections, [loadConnections]);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labels = settings.labels;
  const replace = (s: Staff) => setStaff((list) => list.map((x) => (x.id === s.id ? { ...x, ...s } : x)));

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    try {
      const created = await api<Staff>("staff", { body: staffBody(new FormData(e.currentTarget)) });
      setStaff((list) => [...list, created]);
      setAdding(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function update(e: React.FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    setError(null);
    try {
      replace(await api<Staff>(`staff/${id}`, { method: "PATCH", body: staffBody(new FormData(e.currentTarget)) }));
      setOpen(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!settings.configured) {
    return <p className="card text-sm text-muted">Save the booking rules on Services &amp; settings first.</p>;
  }

  return (
    <div className="space-y-4">
      {notice && <p className={`card text-sm ${notice.ok ? "text-good" : "text-critical"}`} role="status">{notice.text}</p>}
      {error && <p className="text-sm text-critical" role="alert">{error}</p>}
      {staff.length === 0 && !adding && <p className="card text-sm text-muted">No {labels.staff_plural.toLowerCase()} yet.</p>}
      {staff.map((s, i) => (
        <div key={s.id} className="card space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="h-3 w-3 rounded-full" style={{ background: staffColor(s, i) }} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{s.name} {!s.active && <span className="badge ml-1">Inactive</span>}</div>
              <div className="text-sm text-muted">
                {s.skills.length ? s.skills.map((k) => k.replaceAll("_", " ")).join(", ") : "No skills set"}
                {s.zones.length > 0 && ` · ZIPs ${s.zones.join(", ")}`}
              </div>
            </div>
            {canEdit && (
              <button className="btn-secondary py-1.5" onClick={() => setOpen(open === s.id ? null : s.id)}>
                {open === s.id ? "Close" : "Edit"}
              </button>
            )}
          </div>
          {open === s.id && (
            <form onSubmit={(e) => update(e, s.id)} className="space-y-3 border-t border-border pt-4">
              <StaffFields staff={s} settings={settings} color={staffColor(s, i)} />
              <button className="btn">Save</button>
            </form>
          )}
          <div className="border-t border-border pt-4">
            <HoursEditor staff={s} canEdit={canEdit} onSaved={replace} />
          </div>
          {connections && (
            <div className="border-t border-border pt-4">
              <CalendarConnections staffId={s.id} staffName={s.name} data={connections} canEdit={canEdit} onChange={loadConnections} />
            </div>
          )}
          <TimeOffEditor staff={s} tz={s.timezone ?? settings.timezone} canEdit={canEdit} />
        </div>
      ))}
      {canEdit && (adding ? (
        <form onSubmit={create} className="card space-y-3">
          <h3 className="font-semibold">New {labels.staff.toLowerCase()}</h3>
          <StaffFields settings={settings} color={PALETTE[staff.length % PALETTE.length]} />
          <div className="flex gap-2">
            <button className="btn">Add</button>
            <button type="button" className="btn-secondary" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="btn" onClick={() => setAdding(true)}>Add {labels.staff.toLowerCase()}</button>
      ))}
    </div>
  );
}

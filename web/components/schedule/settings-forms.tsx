"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { api } from "./api";
import type { Service, Settings } from "./types";

export type Vertical = { key: string; name: string; default_services: string[] };

const MODES = [
  { key: "least_busy", label: "Least busy first", ready: true },
  { key: "round_robin", label: "Strict rotation", ready: false },
  { key: "weighted", label: "Weighted", ready: false },
  { key: "priority", label: "Preferred first", ready: false },
] as const;

const noSubscription = () => () => {};

function zones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}

export function SettingsForm({ initial, verticals, canEdit }: { initial: Settings; verticals: Vertical[]; canEdit: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const s = initial;
  // A new setup starts from the browser's time zone; the server render has none, so hydration agrees.
  const browserTz = useSyncExternalStore(noSubscription, () => Intl.DateTimeFormat().resolvedOptions().timeZone, () => null);
  const [edited, setEdited] = useState<string | null>(null);
  const timezone = edited ?? (s.configured ? s.timezone : (browserTz ?? s.timezone));

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => Number(f.get(k));
    const cap = String(f.get("default_daily_job_cap") || "").trim();
    setBusy(true);
    setMessage(null);
    try {
      await api("settings", {
        method: "PUT",
        body: {
          vertical: f.get("vertical"),
          timezone: f.get("timezone"),
          slot_granularity_min: num("slot_granularity_min"),
          min_notice_min: Math.round(num("min_notice_hours") * 60),
          emergency_min_notice_min: num("emergency_min_notice_min"),
          max_days_ahead: num("max_days_ahead"),
          hold_ttl_sec: num("hold_ttl_min") * 60,
          default_daily_job_cap: cap ? Number(cap) : null,
          assignment_mode: f.get("assignment_mode"),
          unavailable_on_reauth: s.unavailable_on_reauth,
          service_area: {
            postal_codes: String(f.get("postal_codes") || "").split(/[\s,]+/).map((z) => z.trim()).filter(Boolean),
          },
          labels: s.label_overrides,
        },
      });
      setMessage({ ok: true, text: "Saved." });
      router.refresh();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-5">
      <div>
        <h2 className="font-semibold">Booking rules</h2>
        <p className="text-sm text-muted">Apply to every booking, whether a voice agent or your team makes it.</p>
      </div>
      <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className="label">Industry</span>
          <select name="vertical" className="input" defaultValue={s.vertical}>
            {verticals.map((v) => <option key={v.key} value={v.key}>{v.name}</option>)}
          </select>
          <span className="hint block">Sets the words used (e.g. technician, job), skills and standard services.</span>
        </label>
        <label>
          <span className="label">Time zone</span>
          <input name="timezone" className="input" list="tz-list" value={timezone} onChange={(e) => setEdited(e.target.value)} required />
          <datalist id="tz-list">{zones().map((z) => <option key={z} value={z} />)}</datalist>
        </label>
        <label>
          <span className="label">Start times every</span>
          <select name="slot_granularity_min" className="input" defaultValue={s.slot_granularity_min}>
            {[15, 30, 60, 120].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? "s" : ""}`}</option>)}
          </select>
        </label>
        <label>
          <span className="label">Minimum notice (hours)</span>
          <input name="min_notice_hours" type="number" min={0} step={0.5} className="input" defaultValue={s.min_notice_min / 60} />
        </label>
        <label>
          <span className="label">Emergency notice (minutes)</span>
          <input name="emergency_min_notice_min" type="number" min={0} className="input" defaultValue={s.emergency_min_notice_min} />
        </label>
        <label>
          <span className="label">Book up to (days ahead)</span>
          <input name="max_days_ahead" type="number" min={1} max={365} className="input" defaultValue={s.max_days_ahead} />
        </label>
        <label>
          <span className="label">Hold a slot during a call for (minutes)</span>
          <input name="hold_ttl_min" type="number" min={1} max={30} className="input" defaultValue={Math.round(s.hold_ttl_sec / 60)} />
        </label>
        <label>
          <span className="label">Max jobs per person per day</span>
          <input name="default_daily_job_cap" type="number" min={1} className="input" defaultValue={s.default_daily_job_cap ?? ""} placeholder="No limit" />
        </label>
        <label>
          <span className="label">Who gets the job</span>
          <select name="assignment_mode" className="input" defaultValue={s.assignment_mode}>
            {MODES.map((m) => <option key={m.key} value={m.key} disabled={!m.ready}>{m.label}{m.ready ? "" : " (coming soon)"}</option>)}
          </select>
          <span className="hint block">Among those free with the right skills: fewest jobs that day, then that week.</span>
        </label>
        <label className="sm:col-span-2">
          <span className="label">Service area ZIP / postal codes</span>
          <textarea name="postal_codes" rows={2} className="input" defaultValue={(s.service_area.postal_codes ?? []).join(", ")} placeholder="Leave empty to accept any address" />
        </label>
      </fieldset>
      {canEdit && (
        <div className="flex items-center gap-3">
          <button className="btn" disabled={busy}>{busy ? "Saving…" : s.configured ? "Save" : "Save and continue"}</button>
          {message && <span className={`text-sm ${message.ok ? "text-good" : "text-critical"}`} role="status">{message.text}</span>}
        </div>
      )}
    </form>
  );
}

function splitList(value: FormDataEntryValue | null): string[] {
  return String(value || "").split(",").map((v) => v.trim()).filter(Boolean);
}

export function ServicesEditor({ initial, settings, canEdit }: { initial: Service[]; settings: Settings; canEdit: boolean }) {
  const [services, setServices] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent<HTMLFormElement>, id?: string) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const body = {
      name: f.get("name"),
      duration_min: Number(f.get("duration_min")),
      buffer_before_min: Number(f.get("buffer_before_min")),
      buffer_after_min: Number(f.get("buffer_after_min")),
      required_skills: splitList(f.get("required_skills")),
      active: f.get("active") === "on",
    };
    setError(null);
    try {
      const saved = await api<Service>(id ? `services/${id}` : "services", { method: id ? "PATCH" : "POST", body });
      setServices((list) => (id ? list.map((s) => (s.id === id ? saved : s)) : [...list, saved]));
      if (!id) form.reset();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function addDefaults() {
    setError(null);
    try {
      const added = await api<Service[]>("services/defaults", { method: "POST" });
      setServices((list) => [...list, ...added]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const row = (s?: Service) => (
    <form key={s?.id ?? "new"} onSubmit={(e) => save(e, s?.id)} className="grid items-end gap-2 border-b border-border py-3 sm:grid-cols-[2fr_repeat(3,5rem)_2fr_auto_auto]">
      <label><span className="label text-xs">Name</span><input name="name" className="input" defaultValue={s?.name} required maxLength={120} /></label>
      <label><span className="label text-xs">Minutes</span><input name="duration_min" type="number" min={5} className="input" defaultValue={s?.duration_min ?? 60} /></label>
      <label><span className="label text-xs">Before</span><input name="buffer_before_min" type="number" min={0} className="input" defaultValue={s?.buffer_before_min ?? 0} title="Travel/prep minutes before" /></label>
      <label><span className="label text-xs">After</span><input name="buffer_after_min" type="number" min={0} className="input" defaultValue={s?.buffer_after_min ?? 0} title="Minutes after, before the next job" /></label>
      <label>
        <span className="label text-xs">Required skills</span>
        <input name="required_skills" className="input" list="skills-list" defaultValue={s?.required_skills.join(", ")} placeholder="Anyone" />
      </label>
      <label className="flex items-center gap-1.5 pb-2 text-sm"><input type="checkbox" name="active" defaultChecked={s?.active ?? true} className="h-4 w-4 accent-[var(--accent)]" />Active</label>
      {canEdit && <button className="btn-secondary">{s ? "Save" : "Add"}</button>}
    </form>
  );

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Services</h2>
          <p className="text-sm text-muted">What callers can book, how long it takes, and the travel or prep time kept free around it.</p>
        </div>
        {canEdit && <button className="btn-secondary" onClick={addDefaults}>Add standard services</button>}
      </div>
      <datalist id="skills-list">{settings.skills.map((k) => <option key={k} value={k} />)}</datalist>
      <fieldset disabled={!canEdit}>
        {services.map((s) => row(s))}
        {canEdit && row()}
      </fieldset>
      {error && <p className="text-sm text-critical" role="alert">{error}</p>}
    </section>
  );
}

"use client";

import { useState } from "react";
import { api } from "./api";
import { atLocal, hhmm } from "./tz";
import type { BookingDetail, Labels, Service, Staff } from "./types";

export type Draft = { day: string; minutes: number; staffId?: string };

/** Book a job by hand. Goes through the same engine as the voice agent (skills, overlaps, buffers). */
export function CreateJob({
  draft, tz, services, staff, labels, onClose, onCreated,
}: {
  draft: Draft;
  tz: string;
  services: Service[];
  staff: Staff[];
  labels: Labels;
  onClose: () => void;
  onCreated: (job: BookingDetail) => void;
}) {
  const active = services.filter((s) => s.active);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const [h, m] = String(f.get("time")).split(":").map(Number);
    const start = atLocal(String(f.get("day")), h * 60 + m, tz);
    const line1 = String(f.get("line1") || "").trim();
    setBusy(true);
    setError(null);
    try {
      const job = await api<BookingDetail>("bookings", {
        body: {
          service_id: f.get("service"),
          staff_id: f.get("staff") || null,
          start: start.toISOString(),
          customer: { name: f.get("name"), phone: f.get("phone"), email: f.get("email") || null },
          address: line1 ? { line1, city: f.get("city") || null, postal_code: f.get("postal_code") || null } : null,
          description: f.get("description") || "",
          urgency: f.get("emergency") ? "emergency" : "standard",
          override_rules: Boolean(f.get("override")),
        },
      });
      onCreated(job);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" role="dialog" aria-modal="true" aria-label={`New ${labels.booking}`}>
      <button className="fixed inset-0 bg-black/30" aria-label="Close" onClick={onClose} />
      <form onSubmit={submit} className="card relative mt-10 w-full max-w-lg space-y-4 shadow-xl">
        <h2 className="text-lg font-semibold">New {labels.booking.toLowerCase()}</h2>
        {active.length === 0 ? (
          <p className="text-sm text-muted">Add a service in Schedule settings first.</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className="label">Service</span>
                <select name="service" className="input" required>
                  {active.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.duration_min} min)</option>)}
                </select>
              </label>
              <label>
                <span className="label">Date</span>
                <input name="day" type="date" className="input" defaultValue={draft.day} required />
              </label>
              <label>
                <span className="label">Start</span>
                <input name="time" type="time" className="input" step={300} defaultValue={hhmm(draft.minutes)} required />
              </label>
              <label className="sm:col-span-2">
                <span className="label">{labels.staff}</span>
                <select name="staff" className="input" defaultValue={draft.staffId ?? ""}>
                  <option value="">First available with the right skills</option>
                  {staff.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label>
                <span className="label">{labels.customer} name</span>
                <input name="name" className="input" required maxLength={200} />
              </label>
              <label>
                <span className="label">Phone</span>
                <input name="phone" type="tel" className="input" required maxLength={40} />
              </label>
              <label className="sm:col-span-2">
                <span className="label">Email <span className="font-normal text-muted">(optional)</span></span>
                <input name="email" type="email" className="input" maxLength={200} />
              </label>
              <label className="sm:col-span-2">
                <span className="label">Service address</span>
                <input name="line1" className="input" placeholder="Street and number" maxLength={200} />
              </label>
              <label>
                <span className="label">City</span>
                <input name="city" className="input" maxLength={100} />
              </label>
              <label>
                <span className="label">ZIP / postal code</span>
                <input name="postal_code" className="input" maxLength={20} />
              </label>
              <label className="sm:col-span-2">
                <span className="label">Issue</span>
                <textarea name="description" className="input" rows={2} maxLength={2000} />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="emergency" className="h-4 w-4 accent-[var(--accent)]" /> Emergency
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="override" className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
              <span>
                Allow outside working hours
                <span className="block text-xs text-muted">Double-booking is never allowed.</span>
              </span>
            </label>
          </>
        )}
        {error && <p className="text-sm text-critical" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
          {active.length > 0 && <button className="btn" disabled={busy}>{busy ? "Booking…" : "Book"}</button>}
        </div>
      </form>
    </div>
  );
}

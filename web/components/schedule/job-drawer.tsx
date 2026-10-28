"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Transcript } from "@/components/transcript";
import { api } from "./api";
import { formatDateTime, formatTime } from "./tz";
import type { BookingDetail, ExternalChange, Labels } from "./types";

type CallInfo = {
  id: string;
  started_at: string;
  duration_seconds: number;
  transcript: { role: string; text: string }[];
  transcript_purged_at: string | null;
  has_recording: boolean;
  analysis: { summary?: string; [key: string]: unknown } | null;
};

const STATUS_STYLE: Record<string, string> = {
  confirmed: "border-good text-good",
  held: "border-accent text-accent",
  completed: "text-muted",
  canceled: "border-critical text-critical",
  released: "text-muted",
  expired: "text-muted",
};

const EVENT_LABEL: Record<string, string> = {
  held: "Slot held",
  confirmed: "Booked",
  rescheduled: "Rescheduled",
  canceled: "Canceled",
  released: "Hold released",
  expired: "Hold expired",
  completed: "Completed",
  external_change: "Changed in the technician's calendar",
  external_change_reviewed: "Calendar change reviewed",
};

function addressLine(a: Record<string, string | null> | null): string | null {
  if (!a) return null;
  // Agents often send the whole address as one line; don't repeat the city or ZIP after it.
  const parts: string[] = [];
  for (const value of [a.line1, a.line2, a.city, a.region, a.postal_code]) {
    const v = (value ?? "").trim();
    if (v && !parts.some((p) => p.toLowerCase().includes(v.toLowerCase()))) parts.push(v);
  }
  return parts.join(", ") || null;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 py-1.5 text-sm">
      <div className="text-muted">{label}</div>
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

function actorLabel(type: string, id: string | null): string {
  if (type === "system") return id === "calendar-sync" ? "Calendar sync" : "Automatic";
  return { agent: "Voice agent", api_key: "API", user: "Dashboard" }[type] ?? type;
}

/** Everything about one job. Used in the calendar's side drawer and on /schedule/jobs/[id]. */
export function JobDetail({ id, labels, canEdit, onChanged }: { id: string; labels: Labels; canEdit: boolean; onChanged?: () => void }) {
  const [job, setJob] = useState<BookingDetail | null>(null);
  const [call, setCall] = useState<CallInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api<BookingDetail>(`bookings/${id}`, { signal: controller.signal })
      .then(async (detail) => {
        setJob(detail);
        setError(null);
        if (detail.call_id) {
          const res = await fetch(`/api/schedule-calls/${encodeURIComponent(detail.call_id)}`, { signal: controller.signal });
          if (res.ok) setCall((await res.json()).call);
        }
      })
      .catch((e: Error) => e.name !== "AbortError" && setError(e.message));
    return () => controller.abort();
  }, [id]);

  async function reload() {
    setJob(await api<BookingDetail>(`bookings/${id}`));
  }

  async function act(path: string, body: unknown = {}) {
    setBusy(true);
    try {
      const result = await api<BookingDetail | { ok: boolean }>(`bookings/${id}/${path}`, { body });
      if ("id" in result) setJob(result);
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !job) return <p className="text-sm text-critical">{error}</p>;
  if (!job) return <p className="text-sm text-muted">Loading…</p>;

  const tz = job.timezone;
  const start = new Date(job.start);
  const end = new Date(job.end);
  const address = addressLine(job.service_address);
  const summary = (call?.analysis?.summary as string | undefined) ?? (job.call_artifacts?.summary?.summary as string | undefined);
  const recording = call?.has_recording ? `/api/recordings/${call.id}` : job.call_artifacts?.recording_url;

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`badge ${STATUS_STYLE[job.status] ?? ""}`}>{job.status}</span>
          {job.urgency === "emergency" && <span className="badge border-critical text-critical">Emergency</span>}
          {job.history.some((h) => h.kind === "rescheduled") && <span className="badge">↻ Rescheduled</span>}
          {job.external_change && <span className="badge border-critical text-critical">⚠ Changed in external calendar</span>}
          {job.confirmation_code && <span className="badge font-mono">{job.confirmation_code}</span>}
        </div>
        <h2 className="mt-2 text-lg font-semibold">{job.customer?.name ?? "Held slot"}</h2>
        <p className="text-sm text-muted">
          {formatDateTime(start, tz)} – {formatTime(end, tz)} <span className="text-xs">({tz})</span>
        </p>
      </div>

      {error && <p className="text-sm text-critical">{error}</p>}

      {job.external_change && (
        <ExternalChangeReview change={job.external_change} tz={tz} canEdit={canEdit} busy={busy}
          onAction={(action) => act("external-change", { action }).then(() => reload())} />
      )}

      <div className="divide-y divide-border rounded-lg border border-border px-3">
        <Row label="Service">{job.service?.name ?? "—"}</Row>
        <Row label={labels.staff}>{job.staff?.name ?? "—"}</Row>
        <Row label="Phone">
          {job.customer?.phone ? <a className="text-accent underline" href={`tel:${job.customer.phone}`}>{job.customer.phone}</a> : "—"}
        </Row>
        {job.customer?.email && <Row label="Email">{job.customer.email}</Row>}
        <Row label="Address">
          {address ? (
            <a className="text-accent underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}>
              {address}
            </a>
          ) : (
            "—"
          )}
        </Row>
        <Row label="Issue">{job.description || "—"}</Row>
        {Object.keys(job.details ?? {}).length > 0 && (
          <Row label="Details">
            <ul className="space-y-0.5">
              {Object.entries(job.details).map(([k, v]) => (
                <li key={k}>
                  <span className="text-muted">{k.replaceAll("_", " ")}:</span> {String(v)}
                </li>
              ))}
            </ul>
          </Row>
        )}
        {job.notes && <Row label="Notes">{job.notes}</Row>}
        <Row label="Source">{job.source === "voice_agent" ? "Voice agent" : job.source}</Row>
        {job.cancel_reason && <Row label="Cancel reason">{job.cancel_reason}</Row>}
      </div>

      {canEdit && job.status === "confirmed" && (
        <div className="flex flex-wrap gap-2">
          <button className="btn" disabled={busy} onClick={() => act("complete")}>Mark completed</button>
          <button
            className="btn-secondary text-critical"
            disabled={busy}
            onClick={() => {
              const reason = window.prompt("Reason for canceling (optional)");
              if (reason !== null) void act("cancel", { reason: reason || null });
            }}
          >
            Cancel job
          </button>
        </div>
      )}

      {(recording || summary || call || job.call_artifacts) && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Call</h3>
          {summary && <p className="rounded-lg bg-surface p-3 text-sm">{summary}</p>}
          {recording && <audio controls preload="none" src={recording} className="w-full" />}
          {call && (
            <details className="rounded-lg border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">Transcript</summary>
              <div className="mt-3 max-h-96 overflow-y-auto">
                <Transcript turns={call.transcript} purged={Boolean(call.transcript_purged_at)} />
              </div>
              <Link href={`/calls/${call.id}`} className="mt-2 inline-block text-sm text-accent underline">Open call</Link>
            </details>
          )}
          {!call && job.call_artifacts?.transcript && (
            <details className="rounded-lg border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">Transcript</summary>
              <pre className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap text-sm">{job.call_artifacts.transcript}</pre>
            </details>
          )}
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold">History</h3>
        <ol className="space-y-1.5 text-sm">
          {job.history.map((h, i) => (
            <li key={i} className="flex gap-2">
              <span className="w-40 shrink-0 text-muted">{formatDateTime(new Date(h.at), tz)}</span>
              <span>
                {EVENT_LABEL[h.kind] ?? h.kind}
                <span className="text-muted"> · {actorLabel(h.actor_type, h.actor_id)}</span>
                {h.kind === "rescheduled" && typeof h.data.to_start === "string" && (
                  <span className="text-muted"> → {formatDateTime(new Date(h.data.to_start), tz)}</span>
                )}
                {typeof h.data.reason === "string" && h.data.reason && <span className="text-muted"> ({h.data.reason})</span>}
              </span>
            </li>
          ))}
        </ol>
        {job.assignment_reason && (
          <p className="mt-2 text-xs text-muted">
            Assigned by {String(job.assignment_reason.mode).replace("_", " ")}: {String(job.assignment_reason.jobs_that_day ?? 0)} other jobs that day, rank{" "}
            {String(job.assignment_reason.rank ?? 1)} of {String(job.assignment_reason.candidates ?? job.assignment_reason.of ?? 1)} free.
          </p>
        )}
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Calendar sync</h3>
        {job.sync.length === 0 && job.sync_failures.length === 0 && (
          <p className="text-sm text-muted">
            {job.status === "confirmed" ? `Not in a calendar: ${job.staff?.first_name ?? "this person"} hasn't connected one.` : "Not in any calendar."}
          </p>
        )}
        {job.sync.map((s) => (
          <p key={s.event_id} className="text-sm">
            <span className="badge border-good text-good">In calendar</span>{" "}
            {s.provider === "google" ? "Google" : s.provider}: {s.calendar}
            <span className="text-muted"> · updated {formatDateTime(new Date(s.last_pushed_at), tz)}</span>
          </p>
        ))}
        {job.sync_failures.map((f) => (
          <div key={f.id} className="space-y-1 rounded-md border border-critical/40 p-2 text-sm">
            <p className="text-critical">
              {f.status === "retrying" ? "Retrying the calendar update…" : `Couldn't update the calendar after ${f.attempts} tries.`}
            </p>
            <p className="break-words text-xs text-muted">{f.last_error}</p>
            {f.status !== "retrying" && (
              <button className="btn-secondary py-1" disabled={busy} onClick={async () => {
                setBusy(true);
                try {
                  await api(`sync-failures/${f.id}/retry`, { method: "POST" });
                  await reload();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}>Retry</button>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

function ExternalChangeReview({ change, tz, canEdit, busy, onAction }: {
  change: ExternalChange;
  tz: string;
  canEdit: boolean;
  busy: boolean;
  onAction: (action: "keep" | "revert" | "restore" | "cancel") => void;
}) {
  const where = change.provider === "google" ? "Google Calendar" : change.provider;
  const when = (iso?: string) => (iso ? formatDateTime(new Date(iso), tz) : "");
  let text: string;
  let actions: { action: "keep" | "revert" | "restore" | "cancel"; label: string; danger?: boolean }[];
  if (change.kind === "deleted") {
    text = `The event for this job was deleted in ${where}. The job is still booked.`;
    actions = [{ action: "restore", label: "Put it back on the calendar" }, { action: "keep", label: "Leave it off" }, { action: "cancel", label: "Cancel the job", danger: true }];
  } else if (change.applied) {
    text = `Moved in ${where} from ${when(change.from)} to ${when(change.to)}; the job was moved to match.${change.note ? ` ${change.note}` : ""}`;
    actions = [{ action: "keep", label: "Keep the new time" }, { action: "revert", label: `Move back to ${when(change.from)}` }];
  } else {
    text = `Moved in ${where} to ${when(change.to)}, but the job couldn't follow: ${change.reason ?? "that time isn't free"}.`;
    actions = [{ action: "restore", label: "Put the calendar back to the job's time" }, { action: "cancel", label: "Cancel the job", danger: true }];
  }
  return (
    <div className="space-y-2 rounded-lg border border-critical/50 bg-surface p-3 text-sm" role="alert">
      <p className="font-medium">⚠ Changed outside the schedule</p>
      <p>{text}</p>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <button key={a.action} className={`btn-secondary py-1 ${a.danger ? "text-critical" : ""}`} disabled={busy}
              onClick={() => (!a.danger || window.confirm("Cancel this job?")) && onAction(a.action)}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function JobDrawer({ id, labels, canEdit, onClose, onChanged }: { id: string; labels: Labels; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={labels.booking}>
      <button className="absolute inset-0 bg-black/30" aria-label="Close" onClick={onClose} />
      <div className="relative h-full w-full max-w-lg overflow-y-auto border-l border-border bg-card p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <Link href={`/schedule/jobs/${id}`} className="text-sm text-accent underline">Open as page</Link>
          <button className="btn-secondary px-2 py-1" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <JobDetail id={id} labels={labels} canEdit={canEdit} onChanged={onChanged} />
      </div>
    </div>
  );
}

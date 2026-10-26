"use client";

import { useState } from "react";
import { api } from "./api";
import type { Connection, Connections } from "./types";

const PROVIDER_NAME: Record<string, string> = { google: "Google Calendar", microsoft: "Outlook" };

function ago(iso: string | null): string {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

/** One team member's calendar connections: connect, choose calendars, reconnect, disconnect. */
export function CalendarConnections({
  staffId, staffName, data, canEdit, onChange,
}: {
  staffId: string;
  staffName: string;
  data: Connections;
  canEdit: boolean;
  onChange: () => void;
}) {
  const accounts = data.accounts.filter((a) => a.staff_id === staffId);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      if (done) setMessage(done);
      onChange();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite(provider: string) {
    await act(async () => {
      const { token } = await api<{ token: string }>("connections/invite", { body: { staff_id: staffId, provider } });
      const link = `${window.location.origin}/connect-calendar?provider=${provider}&invite=${encodeURIComponent(token)}`;
      await navigator.clipboard.writeText(link);
    }, `Link copied. Send it to ${staffName.split(" ")[0]}: it works for 7 days.`);
  }

  const connectButtons = (label: (p: string) => string) =>
    data.providers.map((p) => (
      <span key={p} className="flex flex-wrap gap-2">
        <a className="btn-secondary py-1.5" href={`/api/schedule-oauth/${p}/start?staff=${staffId}`}>{label(p)}</a>
        <button type="button" className="text-sm text-accent underline" disabled={busy} onClick={() => copyInvite(p)}>
          Send {staffName.split(" ")[0]} a link instead
        </button>
      </span>
    ));

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">Calendar</h4>
      {accounts.length === 0 && (
        <>
          <p className="text-sm text-muted">
            Not connected. Connect it so jobs appear there and busy times in it are never booked.
          </p>
          {canEdit && (data.providers.length ? <div className="flex flex-wrap gap-3">{connectButtons((p) => `Connect ${PROVIDER_NAME[p] ?? p}`)}</div> : (
            <p className="text-xs text-muted">Calendar connections need the Google sign-in keys on this server (see docs/integrations.md).</p>
          ))}
        </>
      )}
      {accounts.map((a) => (
        <Account key={a.id} account={a} canEdit={canEdit} busy={busy} act={act} reconnect={connectButtons(() => "Reconnect")} />
      ))}
      {message && <p className="text-sm text-muted" role="status">{message}</p>}
    </div>
  );
}

function Account({ account: a, canEdit, busy, act, reconnect }: {
  account: Connection;
  canEdit: boolean;
  busy: boolean;
  act: (fn: () => Promise<unknown>, done?: string) => Promise<void>;
  reconnect: React.ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{PROVIDER_NAME[a.provider] ?? a.provider}</span>
        <span className="text-muted">{a.email}</span>
        {a.status === "active" ? (
          <span className="badge border-good text-good">Connected</span>
        ) : (
          <span className="badge border-critical text-critical">Needs reconnecting</span>
        )}
        <span className="text-xs text-muted">Synced {ago(a.last_sync_at)}</span>
      </div>
      {a.status !== "active" && (
        <div className="space-y-2 rounded-md bg-surface p-2 text-sm">
          <p className="text-critical">
            We can no longer read this calendar{a.last_error ? ` (${a.last_error})` : ""}. Until it&apos;s reconnected, this
            person isn&apos;t booked automatically.
          </p>
          {canEdit && <div className="flex flex-wrap gap-3">{reconnect}</div>}
        </div>
      )}
      <table className="table">
        <thead>
          <tr><th>Calendar</th><th className="text-center">Blocks busy time</th><th className="text-center">Jobs go here</th></tr>
        </thead>
        <tbody>
          {a.calendars.map((c) => (
            <tr key={c.id}>
              <td>
                {c.name}
                {c.is_primary && <span className="ml-1 text-xs text-muted">(main)</span>}
                {c.last_error && <div className="text-xs text-critical">{c.last_error}</div>}
              </td>
              <td className="text-center">
                <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={c.use_for_busy} disabled={!canEdit || busy}
                  aria-label={`${c.name} blocks busy time`}
                  onChange={(e) => act(() => api(`connections/calendars/${c.id}`, { method: "PATCH", body: { use_for_busy: e.target.checked } }))} />
              </td>
              <td className="text-center">
                <input type="radio" name={`write-${a.id}`} className="h-4 w-4 accent-[var(--accent)]" checked={c.write_bookings_here}
                  disabled={!canEdit || busy || !c.writable} title={c.writable ? undefined : "Read-only calendar"}
                  aria-label={`Jobs go to ${c.name}`}
                  onChange={() => act(() => api(`connections/calendars/${c.id}`, { method: "PATCH", body: { write_bookings_here: true } }), "Upcoming jobs are moving to that calendar.")} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-3 text-sm">
        <button type="button" className="text-accent underline" disabled={busy}
          onClick={() => act(() => api(`connections/${a.id}/sync`, { method: "POST" }), "Syncing now.")}>Sync now</button>
        {canEdit && (
          <button type="button" className="text-critical underline" disabled={busy}
            onClick={() => {
              if (window.confirm(`Disconnect ${a.email}? Access is revoked and the calendar data we keep is deleted. Jobs already in the calendar stay there.`)) {
                void act(() => api(`connections/${a.id}`, { method: "DELETE" }), "Disconnected.");
              }
            }}>Disconnect</button>
        )}
      </div>
    </div>
  );
}

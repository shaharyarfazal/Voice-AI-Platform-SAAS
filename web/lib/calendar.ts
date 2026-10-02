import "server-only";
import { decrypt, encrypt } from "./crypto";
import { sql } from "./db";
import { integrationEndpoint, refreshTokens, type OAuthProvider } from "./oauth";
import type { Interval } from "./scheduling";

export type IntegrationRow = {
  id: string;
  tenant_id: string;
  provider: OAuthProvider;
  account_email: string;
  access_token_enc: string;
  refresh_token_enc: string | null;
  expires_at: Date;
};

export class CalendarError extends Error {}

/** A valid access token, refreshed and saved if it's about to expire. */
async function accessToken(row: IntegrationRow): Promise<string> {
  if (row.expires_at.getTime() - Date.now() > 60_000) return decrypt(row.access_token_enc);
  if (!row.refresh_token_enc) throw new CalendarError("The calendar connection expired. Reconnect it on the Integrations page.");
  try {
    const t = await refreshTokens(row.provider, decrypt(row.refresh_token_enc));
    await sql`
      UPDATE integrations SET access_token_enc = ${encrypt(t.accessToken)},
        refresh_token_enc = coalesce(${t.refreshToken ? encrypt(t.refreshToken) : null}, refresh_token_enc),
        expires_at = ${t.expiresAt}, status = 'connected', last_error = NULL
      WHERE id = ${row.id}`;
    return t.accessToken;
  } catch (e) {
    await sql`UPDATE integrations SET status = 'error', last_error = ${String(e)} WHERE id = ${row.id}`;
    throw new CalendarError("The calendar connection stopped working. Reconnect it on the Integrations page.");
  }
}

async function api(row: IntegrationRow, url: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken(row);
  const res = await fetch(integrationEndpoint(url), {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new CalendarError(`Calendar request failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  return res;
}

/** Busy intervals between two instants. */
export async function busyTimes(row: IntegrationRow, calendarId: string, window: Interval): Promise<Interval[]> {
  if (row.provider === "google") {
    const res = await api(row, "https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      body: JSON.stringify({ timeMin: window.start.toISOString(), timeMax: window.end.toISOString(), items: [{ id: calendarId }] }),
    });
    const data = await res.json();
    const cal = data.calendars?.[calendarId];
    if (cal?.errors?.length) throw new CalendarError(`Google Calendar: ${cal.errors[0].reason}`);
    return (cal?.busy ?? []).map((b: { start: string; end: string }) => ({ start: new Date(b.start), end: new Date(b.end) }));
  }

  // Microsoft Graph: events in the window, in UTC. Anything not marked "free" blocks the slot.
  const params = new URLSearchParams({
    startDateTime: window.start.toISOString(),
    endDateTime: window.end.toISOString(),
    $select: "start,end,showAs,isCancelled",
    $top: "200",
  });
  const res = await api(row, `https://graph.microsoft.com/v1.0/me/calendarView?${params}`, {
    headers: { prefer: 'outlook.timezone="UTC"' },
  });
  const data = await res.json();
  type GraphEvent = { start: { dateTime: string }; end: { dateTime: string }; showAs?: string; isCancelled?: boolean };
  return (data.value ?? [])
    .filter((e: GraphEvent) => !e.isCancelled && e.showAs !== "free")
    .map((e: GraphEvent) => ({ start: new Date(`${e.start.dateTime.replace(/Z$/, "")}Z`), end: new Date(`${e.end.dateTime.replace(/Z$/, "")}Z`) }));
}

export type NewEvent = {
  title: string;
  description: string;
  start: Date;
  end: Date;
  timeZone: string;
  attendeeEmail?: string;
  attendeeName: string;
};

/** Creates the event; with an attendee email the provider emails them an invitation. Returns the event id. */
export async function createEvent(row: IntegrationRow, calendarId: string, e: NewEvent): Promise<string> {
  if (row.provider === "google") {
    const res = await api(
      row,
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`,
      {
        method: "POST",
        body: JSON.stringify({
          summary: e.title,
          description: e.description,
          start: { dateTime: e.start.toISOString(), timeZone: e.timeZone },
          end: { dateTime: e.end.toISOString(), timeZone: e.timeZone },
          attendees: e.attendeeEmail ? [{ email: e.attendeeEmail, displayName: e.attendeeName }] : [],
        }),
      },
    );
    return (await res.json()).id;
  }
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "");
  const res = await api(row, "https://graph.microsoft.com/v1.0/me/events", {
    method: "POST",
    body: JSON.stringify({
      subject: e.title,
      body: { contentType: "text", content: e.description },
      start: { dateTime: iso(e.start), timeZone: "UTC" },
      end: { dateTime: iso(e.end), timeZone: "UTC" },
      attendees: e.attendeeEmail ? [{ emailAddress: { address: e.attendeeEmail, name: e.attendeeName }, type: "required" }] : [],
    }),
  });
  return (await res.json()).id;
}

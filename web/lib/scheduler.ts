import "server-only";
import { createHmac } from "node:crypto";
import type { Session } from "./auth";

// Client for the scheduling engine (scheduler/ service). Dashboard requests carry a 60-second JWT
// naming the signed-in user's workspace and role; the engine trusts nothing else from the browser.

const BASE = (process.env.SCHEDULER_URL || "http://127.0.0.1:8100").replace(/\/$/, "");

export function schedulerConfigured(): boolean {
  return Boolean(process.env.SCHED_JWT_SECRET);
}

function b64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

export function schedulerToken(session: Session): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ sub: session.userId, bid: session.tenantId, role: session.role, aud: "sched", iat: now, exp: now + 60 }));
  const signature = createHmac("sha256", process.env.SCHED_JWT_SECRET!).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

/** A dashboard API call (`path` starts with /v1/) as the signed-in user. */
export async function schedulerFetch(session: Session, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${schedulerToken(session)}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${BASE}${path}`, { ...init, headers, cache: "no-store", signal: init.signal ?? AbortSignal.timeout(15_000) });
}

export type SchedulerResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string };

export async function schedulerJson<T>(session: Session, path: string, init?: RequestInit): Promise<SchedulerResult<T>> {
  try {
    const res = await schedulerFetch(session, path, init);
    const body = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: body as T };
    return { ok: false, status: res.status, code: body?.code ?? "error", message: body?.message ?? `Scheduler error ${res.status}` };
  } catch {
    return { ok: false, status: 503, code: "unavailable", message: "The scheduling service isn't reachable." };
  }
}

/** Server-to-server calls (OAuth redirects, provider notifications) that aren't made as a user. */
export async function schedulerInternal(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${process.env.INTERNAL_API_TOKEN}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${BASE}${path}`, { ...init, headers, cache: "no-store", signal: init.signal ?? AbortSignal.timeout(20_000) });
}

export const CALENDAR_NONCE_COOKIE = "sched_oauth_nonce";
export const CALENDAR_PROVIDERS = ["google"] as const;

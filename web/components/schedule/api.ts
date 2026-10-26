"use client";

import type { ApiError } from "./types";

/** Calls the scheduling engine through the web app's proxy. Throws the engine's error message. */
export async function api<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const res = await fetch(`/api/schedule/${path.replace(/^\//, "")}`, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: init?.signal,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data ?? {}) as Partial<ApiError>;
    throw Object.assign(new Error(err.message || `Request failed (${res.status})`), { code: err.code, status: res.status });
  }
  return data as T;
}

export const PALETTE = ["#2563eb", "#16a34a", "#d97706", "#9333ea", "#0891b2", "#db2777", "#65a30d", "#dc2626", "#4f46e5", "#0d9488"];

export function staffColor(staff: { id: string; color: string | null }, index: number): string {
  return staff.color || PALETTE[index % PALETTE.length];
}

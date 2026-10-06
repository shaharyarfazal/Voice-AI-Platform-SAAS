import "server-only";

// Fixed-window counters in memory (one web process). Enough to stop abuse of public endpoints
// like widgets; a restart resets them.

const windows = new Map<string, { start: number; count: number }>();

/** True if the action is allowed, counting it. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 50_000) {
      for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
    }
    return true;
  }
  if (w.count >= limit) return false;
  w.count++;
  return true;
}

/**
 * The visitor's IP. X-Real-IP is set by nginx from the connection itself; otherwise the last
 * X-Forwarded-For entry is the one our own proxy added (earlier entries can be faked by the client).
 */
export function clientIp(request: Request): string {
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const chain = (request.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return chain[chain.length - 1] ?? "unknown";
}

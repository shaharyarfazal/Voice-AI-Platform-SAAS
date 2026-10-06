import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { sql } from "./db";
import { publicUrl } from "./oauth";
import { clientIp, rateLimit } from "./rate-limit";
import { brandingFor } from "./workspace";

// Website widgets. The embed code carries only a public key (wpk_...), which is safe to show:
// what it can do is limited to this widget's agent, to the allowed websites, and by rate limits.

export const AppearanceSchema = z.object({
  title: z.string().trim().max(60).default("Chat with us"),
  subtitle: z.string().trim().max(120).default("We usually reply instantly"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#2563eb"),
  position: z.enum(["right", "left"]).default("right"),
  launcherLabel: z.string().trim().max(40).default(""),
});
export type Appearance = z.infer<typeof AppearanceSchema>;

export type Widget = {
  id: string;
  tenant_id: string;
  agent_id: string;
  name: string;
  mode: "chat" | "voice" | "both";
  public_key: string;
  allowed_origins: string[];
  appearance: unknown;
  enabled: boolean;
};

export function newPublicKey(): string {
  return `wpk_${randomBytes(18).toString("base64url")}`;
}

export async function loadWidget(publicKey: string): Promise<(Widget & { tenant_status: string; agent_type: string }) | null> {
  if (!/^wpk_[\w-]{10,60}$/.test(publicKey)) return null;
  const [w] = await sql<(Widget & { tenant_status: string; agent_type: string })[]>`
    SELECT w.*, t.status AS tenant_status, a.type AS agent_type FROM widgets w
    JOIN tenants t ON t.id = w.tenant_id JOIN agents a ON a.id = w.agent_id WHERE w.public_key = ${publicKey}`;
  return w ?? null;
}

/** "https://example.com/page" or "example.com" -> "https://example.com". */
export function normaliseOrigin(raw: string): string | null {
  const v = raw.trim().toLowerCase().replace(/\/+$/, "");
  if (!v) return null;
  try {
    const u = new URL(/^https?:\/\//.test(v) ? v : `https://${v}`);
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Whether a page on `origin` may use the widget. Listed origins also allow their www/non-www twin.
 * The dashboard itself is always allowed (for the preview).
 */
export function originAllowed(widget: Pick<Widget, "allowed_origins">, origin: string | null, request?: Request): boolean {
  if (!origin) return false;
  if (origin === publicUrl("/").origin) return true;
  // The dashboard on an agency's custom domain (same host as this request).
  try {
    if (request && new URL(origin).host === request.headers.get("host")) return true;
  } catch {
    return false;
  }
  if (widget.allowed_origins.length === 0) return true;
  const twin = (o: string) => o.replace(/^(https?:\/\/)www\./, "$1");
  return widget.allowed_origins.some((o) => twin(o) === twin(origin));
}

export function corsHeaders(origin: string | null): Record<string, string> {
  return origin
    ? {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "600",
        vary: "Origin",
      }
    : {};
}

export function json(body: unknown, status: number, origin: string | null): Response {
  return Response.json(body, { status, headers: { ...corsHeaders(origin), "cache-control": "no-store" } });
}

/** Common checks for every public widget request. Returns the widget or an error response. */
export async function guard(
  request: Request,
  publicKey: string,
  limit: { name: string; perIp: number; perWidget: number; windowMs: number },
): Promise<{ widget: Widget & { agent_type: string }; origin: string } | Response> {
  const origin = request.headers.get("origin");
  const widget = await loadWidget(publicKey);
  if (!widget || !widget.enabled || widget.tenant_status !== "active") return json({ error: "This widget isn't available." }, 404, origin);
  if (!originAllowed(widget, origin, request)) return json({ error: "This website isn't allowed to use this widget." }, 403, null);
  const ip = clientIp(request);
  if (!rateLimit(`w:${limit.name}:${widget.id}:${ip}`, limit.perIp, limit.windowMs) || !rateLimit(`w:${limit.name}:${widget.id}`, limit.perWidget, limit.windowMs)) {
    return json({ error: "Too many requests. Please wait a moment and try again." }, 429, origin);
  }
  return { widget, origin: origin! };
}

/** Ties a chat conversation to the browser that started it. */
export function chatToken(sessionId: string, widgetId: string): string {
  return createHmac("sha256", process.env.SESSION_SECRET!).update(`widget-chat:${sessionId}:${widgetId}`).digest("base64url");
}

export function verifyChatToken(sessionId: string, widgetId: string, token: string): boolean {
  const expected = Buffer.from(chatToken(sessionId, widgetId));
  const given = Buffer.from(token ?? "");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function publicConfig(widget: Widget & { agent_type: string }) {
  const [agent] = await sql<{ greeting: string }[]>`SELECT greeting FROM agents WHERE id = ${widget.agent_id}`;
  const brand = await brandingFor(widget.tenant_id);
  return {
    mode: widget.mode,
    appearance: AppearanceSchema.parse(widget.appearance ?? {}),
    greeting: agent?.greeting ?? "",
    poweredBy: brand.hidePoweredBy ? null : brand.productName,
  };
}

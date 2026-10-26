import { getSession } from "@/lib/auth";
import { schedulerConfigured, schedulerFetch } from "@/lib/scheduler";

// Browser → scheduling engine. /api/schedule/<path> is forwarded to the engine's /v1/<path> as the
// signed-in user; the engine scopes everything to their workspace and checks their role.

const SAFE_PATH = /^[A-Za-z0-9/_-]+$/;

async function forward(request: Request, ctx: RouteContext<"/api/schedule/[...path]">): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ ok: false, code: "unauthorized", message: "Sign in again." }, { status: 401 });
  if (!schedulerConfigured()) {
    return Response.json({ ok: false, code: "not_configured", message: "The scheduling service isn't set up on this server." }, { status: 503 });
  }
  const { path } = await ctx.params;
  const joined = path.join("/");
  if (!SAFE_PATH.test(joined)) return Response.json({ ok: false, code: "not_found", message: "Not found" }, { status: 404 });
  const query = new URL(request.url).search;
  const body = request.method === "GET" || request.method === "DELETE" ? undefined : await request.text();
  try {
    const res = await schedulerFetch(session, `/v1/${joined}${query}`, { method: request.method, body });
    return new Response(res.status === 204 ? null : await res.text(), {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ ok: false, code: "unavailable", message: "The scheduling service isn't reachable." }, { status: 503 });
  }
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;

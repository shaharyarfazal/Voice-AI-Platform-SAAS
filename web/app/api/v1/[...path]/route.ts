import { authenticateApiKey } from "@/lib/api-keys";
import { ApiError, HANDLERS } from "@/lib/api/handlers";
import { ENDPOINTS, pathPattern } from "@/lib/api/spec";
import { rateLimit } from "@/lib/rate-limit";

// Public REST API: /api/v1/... with `Authorization: Bearer vk_...`. Routes come from lib/api/spec.ts.

const ROUTES = ENDPOINTS.map((e) => ({ ...e, pattern: pathPattern(e.path) }));
for (const r of ROUTES) if (!HANDLERS[r.id]) throw new Error(`API endpoint ${r.id} has no handler`);

function error(status: number, code: string, message: string, headers?: HeadersInit) {
  return Response.json({ error: { code, message } }, { status, headers });
}

async function handle(request: Request, method: string): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, "");
  const matches = ROUTES.filter((r) => r.pattern.test(path));
  if (matches.length === 0) return error(404, "not_found", `No endpoint ${path}. See /docs.`);
  const route = matches.find((r) => r.method === method);
  if (!route) return error(405, "method_not_allowed", `${path} supports ${matches.map((r) => r.method).join(", ")}`);

  const caller = await authenticateApiKey(request);
  if (!caller) return error(401, "unauthorized", "Send a valid API key: Authorization: Bearer vk_…");
  if (!rateLimit(`api:${caller.keyId}`, 120, 60_000)) return error(429, "rate_limited", "Up to 120 requests a minute per key.", { "retry-after": "60" });

  const params = (route.pattern.exec(path)?.groups ?? {}) as Record<string, string>;
  try {
    const result = await HANDLERS[route.id]({ caller, request, params, url });
    return Response.json(result, { status: method === "POST" && route.id.startsWith("create") ? 201 : 200 });
  } catch (e) {
    if (e instanceof ApiError) return error(e.status, e.code, e.message);
    console.error(`api ${method} ${path} failed`, e);
    return error(500, "server_error", "Something went wrong. Try again.");
  }
}

export const GET = (r: Request) => handle(r, "GET");
export const POST = (r: Request) => handle(r, "POST");
export const PATCH = (r: Request) => handle(r, "PATCH");
export const DELETE = (r: Request) => handle(r, "DELETE");

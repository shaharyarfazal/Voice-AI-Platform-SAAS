import { schedulerInternal } from "@/lib/scheduler";

// Calendar change notifications (Google push channels). Passed straight to the scheduling engine,
// which checks the channel's secret, acknowledges at once and syncs in the background.
export async function POST(request: Request, ctx: RouteContext<"/api/schedule-webhooks/[provider]">) {
  const { provider } = await ctx.params;
  if (!/^[a-z]+$/.test(provider)) return new Response(null, { status: 404 });
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (key.startsWith("x-goog-") || key === "content-type") headers.set(key, value);
  });
  try {
    const res = await schedulerInternal(`/webhooks/${provider}`, {
      method: "POST",
      headers,
      body: await request.arrayBuffer(),
      signal: AbortSignal.timeout(5_000),
    });
    return new Response(null, { status: res.status });
  } catch {
    // Tell the provider to try again later; reconciliation catches up regardless.
    return new Response(null, { status: 503 });
  }
}

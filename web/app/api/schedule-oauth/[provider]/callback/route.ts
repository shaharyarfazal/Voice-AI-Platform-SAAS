import { NextResponse } from "next/server";
import { publicUrl } from "@/lib/oauth";
import { CALENDAR_NONCE_COOKIE, schedulerInternal } from "@/lib/scheduler";

// The provider sends the person back here after they approve calendar access.
export async function GET(request: Request, ctx: RouteContext<"/api/schedule-oauth/[provider]/callback">) {
  const { provider } = await ctx.params;
  const url = new URL(request.url);
  const nonce = request.headers.get("cookie")?.match(new RegExp(`${CALENDAR_NONCE_COOKIE}=([^;]+)`))?.[1] ?? "";
  const go = (path: string) => {
    const res = NextResponse.redirect(publicUrl(path));
    res.cookies.delete({ name: CALENDAR_NONCE_COOKIE, path: "/api/schedule-oauth" });
    return res;
  };
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error") || !code || !state) {
    return go(`/connect-calendar?error=${encodeURIComponent("Access wasn't granted, so the calendar isn't connected.")}`);
  }
  let res: Response;
  try {
    res = await schedulerInternal(`/connect/${provider}/callback`, {
      method: "POST",
      body: JSON.stringify({ code, state, nonce, redirect_uri: publicUrl(`/api/schedule-oauth/${provider}/callback`).toString() }),
    });
  } catch {
    return go(`/connect-calendar?error=${encodeURIComponent("The scheduling service isn't reachable. Try again in a minute.")}`);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) return go(`/connect-calendar?error=${encodeURIComponent(body?.message ?? "Couldn't connect the calendar.")}`);
  if (body.via === "user") return go(`/schedule/team?connected=${encodeURIComponent(body.email)}`);
  return go(`/connect-calendar?connected=${encodeURIComponent(body.email)}&name=${encodeURIComponent(body.staff_name)}`);
}

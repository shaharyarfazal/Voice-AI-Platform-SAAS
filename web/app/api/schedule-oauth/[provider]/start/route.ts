import { NextResponse } from "next/server";
import { getSession, hasRole } from "@/lib/auth";
import { publicUrl } from "@/lib/oauth";
import { CALENDAR_NONCE_COOKIE, CALENDAR_PROVIDERS, schedulerFetch, schedulerInternal } from "@/lib/scheduler";

// Connect a team member's calendar to the scheduling engine.
//   ?staff=<id>      an owner/admin connecting on the person's behalf (signed in)
//   ?invite=<token>  the person themselves, from the link they were sent (no sign-in)
export async function GET(request: Request, ctx: RouteContext<"/api/schedule-oauth/[provider]/start">) {
  const { provider } = await ctx.params;
  if (!(CALENDAR_PROVIDERS as readonly string[]).includes(provider)) return new Response("Unknown provider", { status: 404 });
  const url = new URL(request.url);
  const redirectUri = publicUrl(`/api/schedule-oauth/${provider}/callback`).toString();
  const invite = url.searchParams.get("invite");
  const fail = (message: string) =>
    NextResponse.redirect(publicUrl(invite ? `/connect-calendar?error=${encodeURIComponent(message)}` : `/schedule/team?error=${encodeURIComponent(message)}`));

  let res: Response;
  try {
    if (invite) {
      res = await schedulerInternal(`/connect/${provider}/authorize-invite`, { method: "POST", body: JSON.stringify({ invite, redirect_uri: redirectUri }) });
    } else {
      const session = await getSession();
      if (!session) return NextResponse.redirect(publicUrl("/login"));
      if (!hasRole(session, "admin")) return fail("Only owners and admins can connect calendars for the team.");
      res = await schedulerFetch(session, `/v1/connections/${provider}/authorize`, {
        method: "POST",
        body: JSON.stringify({ staff_id: url.searchParams.get("staff"), redirect_uri: redirectUri }),
      });
    }
  } catch {
    return fail("The scheduling service isn't reachable. Try again in a minute.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.url) return fail(body?.message ?? "Couldn't start connecting.");

  const out = NextResponse.redirect(body.url);
  // Ties the callback to this browser: a link started elsewhere can't complete here.
  out.cookies.set(CALENDAR_NONCE_COOKIE, body.nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/schedule-oauth",
    maxAge: 900,
  });
  return out;
}

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { authorizeUrl, createState, isConfigured, OAUTH_NONCE_COOKIE, publicUrl, type OAuthProvider } from "@/lib/oauth";


// GET /api/oauth/google/start?purpose=login|connect
export async function GET(request: Request, ctx: RouteContext<"/api/oauth/[provider]/start">) {
  const { provider } = await ctx.params;
  const url = new URL(request.url);
  const purpose = url.searchParams.get("purpose") === "connect" ? "connect" : "login";
  if (provider !== "google" && provider !== "microsoft") return new Response("Unknown provider", { status: 404 });
  const p = provider as OAuthProvider;
  const back = purpose === "connect" ? "/integrations" : "/login";
  if (!isConfigured(p)) return NextResponse.redirect(publicUrl(`${back}?error=not_configured`));
  if (purpose === "connect" && !(await getSession())) return NextResponse.redirect(publicUrl("/login"));

  const { state, nonce } = createState(p, purpose);
  const res = NextResponse.redirect(authorizeUrl(p, purpose, state));
  res.cookies.set(OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/oauth",
    maxAge: 600,
  });
  return res;
}

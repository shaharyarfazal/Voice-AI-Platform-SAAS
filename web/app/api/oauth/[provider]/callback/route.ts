import { NextResponse } from "next/server";
import { createSession, getSession } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { sql } from "@/lib/db";
import { exchangeCode, fetchProfile, OAUTH_NONCE_COOKIE, publicUrl, verifyState, type OAuthProvider } from "@/lib/oauth";
import { getSettings } from "@/lib/settings";

export async function GET(request: Request, ctx: RouteContext<"/api/oauth/[provider]/callback">) {
  const { provider } = await ctx.params;
  const url = new URL(request.url);
  const go = (path: string) => {
    const res = NextResponse.redirect(publicUrl(path));
    res.cookies.delete({ name: OAUTH_NONCE_COOKIE, path: "/api/oauth" });
    return res;
  };

  const nonce = request.headers.get("cookie")?.match(new RegExp(`${OAUTH_NONCE_COOKIE}=([^;]+)`))?.[1];
  const state = verifyState(url.searchParams.get("state") ?? "", nonce);
  if (!state || state.p !== provider) return go("/login?error=expired");
  const back = state.purpose === "connect" ? "/integrations" : "/login";
  if (url.searchParams.get("error")) return go(`${back}?error=denied`);
  const code = url.searchParams.get("code");
  if (!code) return go(`${back}?error=denied`);

  const p = provider as OAuthProvider;
  let tokens, profile;
  try {
    tokens = await exchangeCode(p, code);
    profile = await fetchProfile(p, tokens.accessToken);
  } catch (e) {
    console.error("oauth callback failed", e);
    return go(`${back}?error=provider`);
  }

  if (state.purpose === "login") {
    let [user] = await sql<{ id: string; tenant_id: string }[]>`SELECT id, tenant_id FROM users WHERE email = ${profile.email}`;
    if (!user) {
      if (!(await getSettings()).allowSignup) return go("/login?error=no_account");
      [user] = await sql.begin(async (tx) => {
        const [tenant] = await tx`INSERT INTO tenants (name) VALUES (${profile.name}) RETURNING id`;
        return tx<{ id: string; tenant_id: string }[]>`
          INSERT INTO users (tenant_id, email, password_hash) VALUES (${tenant.id}, ${profile.email}, NULL)
          RETURNING id, tenant_id`;
      });
    }
    await sql`UPDATE users SET last_login_at = now() WHERE id = ${user.id}`;
    await createSession({ userId: user.id, tenantId: user.tenant_id });
    return go("/");
  }

  const session = await getSession();
  if (!session) return go("/login");
  await sql`
    INSERT INTO integrations (tenant_id, provider, account_email, access_token_enc, refresh_token_enc, expires_at, scopes)
    VALUES (${session.tenantId}, ${p}, ${profile.email}, ${encrypt(tokens.accessToken)},
            ${tokens.refreshToken ? encrypt(tokens.refreshToken) : null}, ${tokens.expiresAt}, ${tokens.scope})
    ON CONFLICT (tenant_id, provider, account_email) DO UPDATE SET
      access_token_enc = EXCLUDED.access_token_enc,
      refresh_token_enc = coalesce(EXCLUDED.refresh_token_enc, integrations.refresh_token_enc),
      expires_at = EXCLUDED.expires_at, scopes = EXCLUDED.scopes, status = 'connected', last_error = NULL`;
  return go(`/integrations?connected=${p}`);
}

import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type OAuthProvider = "google" | "microsoft";
export const OAUTH_NONCE_COOKIE = "oauth_nonce";
export type OAuthPurpose = "login" | "connect";

// INTEGRATIONS_TEST_BASE_URL, for automated tests only, points every provider endpoint at a mock server.
function endpoint(url: string): string {
  const base = process.env.INTEGRATIONS_TEST_BASE_URL;
  if (!base) return url;
  const u = new URL(url);
  return `${base.replace(/\/$/, "")}/${u.hostname}${u.pathname}${u.search}`;
}

const CONFIG = {
  google: {
    label: "Google",
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    loginScopes: ["openid", "email", "profile"],
    connectScopes: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.readonly",
    ],
    extraAuthorizeParams: { access_type: "offline", include_granted_scopes: "true" } as Record<string, string>,
  },
  microsoft: {
    label: "Microsoft",
    clientId: () => process.env.MICROSOFT_CLIENT_ID,
    clientSecret: () => process.env.MICROSOFT_CLIENT_SECRET,
    // "common" accepts both work/school and personal (Outlook.com) accounts.
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    loginScopes: ["openid", "email", "profile", "User.Read"],
    connectScopes: ["openid", "email", "profile", "offline_access", "User.Read", "Calendars.ReadWrite"],
    extraAuthorizeParams: {} as Record<string, string>,
  },
} as const;

export function providerLabel(p: OAuthProvider): string {
  return CONFIG[p].label;
}

export function isConfigured(p: OAuthProvider): boolean {
  return Boolean(CONFIG[p].clientId() && CONFIG[p].clientSecret());
}

export function configuredProviders(): OAuthProvider[] {
  return (["google", "microsoft"] as const).filter(isConfigured);
}

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** Behind nginx the request URL is the internal address, so redirects use the public APP_URL. */
export function publicUrl(path: string): URL {
  return new URL(path, appUrl());
}

export function redirectUri(p: OAuthProvider): string {
  return `${appUrl()}/api/oauth/${p}/callback`;
}

// The state parameter is signed and carries the purpose; a matching nonce cookie ties it to the
// browser that started the flow (CSRF protection).
type State = { p: OAuthProvider; purpose: OAuthPurpose; nonce: string; exp: number; next?: string };

function sign(value: string): string {
  return createHmac("sha256", `oauth:${process.env.SESSION_SECRET}`).update(value).digest("base64url");
}

export function createState(provider: OAuthProvider, purpose: OAuthPurpose, next?: string): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ p: provider, purpose, nonce, exp: Date.now() + 10 * 60_000, next } satisfies State),
  ).toString("base64url");
  return { state: `${payload}.${sign(payload)}`, nonce };
}

export function verifyState(state: string, nonceCookie: string | undefined): State | null {
  const [payload, signature] = state.split(".");
  if (!payload || !signature || !nonceCookie) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as State;
  if (data.exp < Date.now() || data.nonce !== nonceCookie) return null;
  return data;
}

export function authorizeUrl(p: OAuthProvider, purpose: OAuthPurpose, state: string): string {
  const c = CONFIG[p];
  const params = new URLSearchParams({
    client_id: c.clientId()!,
    redirect_uri: redirectUri(p),
    response_type: "code",
    scope: (purpose === "connect" ? c.connectScopes : c.loginScopes).join(" "),
    state,
    // Re-consent on connect so Google returns a refresh token every time.
    prompt: purpose === "connect" ? "consent" : "select_account",
    ...(purpose === "connect" ? c.extraAuthorizeParams : {}),
  });
  return `${endpoint(c.authorizeUrl)}?${params}`;
}

export type TokenSet = { accessToken: string; refreshToken?: string; expiresAt: Date; scope: string };

async function tokenRequest(p: OAuthProvider, body: Record<string, string>): Promise<TokenSet> {
  const c = CONFIG[p];
  const res = await fetch(endpoint(c.tokenUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.clientId()!, client_secret: c.clientSecret()!, ...body }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${c.label} token request failed: ${data.error_description ?? data.error ?? res.status}`);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + (Number(data.expires_in) || 3600) * 1000),
    scope: data.scope ?? "",
  };
}

export function exchangeCode(p: OAuthProvider, code: string): Promise<TokenSet> {
  return tokenRequest(p, { grant_type: "authorization_code", code, redirect_uri: redirectUri(p) });
}

export function refreshTokens(p: OAuthProvider, refreshToken: string): Promise<TokenSet> {
  return tokenRequest(p, { grant_type: "refresh_token", refresh_token: refreshToken });
}

export type Profile = { email: string; name: string };

export async function fetchProfile(p: OAuthProvider, accessToken: string): Promise<Profile> {
  const url = p === "google" ? "https://openidconnect.googleapis.com/v1/userinfo" : "https://graph.microsoft.com/v1.0/me";
  const res = await fetch(endpoint(url), {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Could not read the ${CONFIG[p].label} profile (${res.status})`);
  const d = await res.json();
  if (p === "google") {
    if (!d.email || d.email_verified === false) throw new Error("Your Google account's email isn't verified");
    return { email: String(d.email).toLowerCase(), name: d.name ?? d.email };
  }
  // Not `mail`: any Entra tenant can set it to someone else's address. The user principal name
  // must be on a domain the tenant verified (or is the personal account's sign-in email).
  const upn = String(d.userPrincipalName ?? "").toLowerCase();
  if (!upn.includes("@") || upn.includes("#ext#")) throw new Error("Sign in with your own Microsoft work or personal account");
  return { email: upn, name: d.displayName ?? upn };
}

export { endpoint as integrationEndpoint };

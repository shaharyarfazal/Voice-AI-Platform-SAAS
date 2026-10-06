import "server-only";
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { sql } from "./db";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const SESSION_COOKIE = "session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

export type Role = "owner" | "admin" | "member";
export type Session = { userId: string; tenantId: string; role: Role };
const RANK: Record<Role, number> = { member: 1, admin: 2, owner: 3 };

/**
 * The user's role in a workspace: their own membership, or their membership of the agency that
 * owns it (agency owners and admins manage their sub-accounts).
 */
export async function roleIn(userId: string, tenantId: string): Promise<Role | null> {
  const [row] = await sql<{ role: Role }[]>`
    SELECT role FROM memberships WHERE tenant_id = ${tenantId} AND user_id = ${userId}
    UNION ALL
    SELECT m.role FROM tenants t JOIN memberships m ON m.tenant_id = t.parent_id
    WHERE t.id = ${tenantId} AND m.user_id = ${userId} AND m.role IN ('owner', 'admin')
    LIMIT 1`;
  return row?.role ?? null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  // Accounts created with Google/Microsoft sign-in have no password.
  if (!stored) return false;
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

function sign(value: string): string {
  return createHmac("sha256", process.env.SESSION_SECRET!).update(value).digest("base64url");
}

export async function createSession(session: { userId: string; tenantId: string }): Promise<void> {
  const payload = Buffer.from(
    JSON.stringify({ userId: session.userId, tenantId: session.tenantId, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }),
  ).toString("base64url");
  (await cookies()).set(SESSION_COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * The signed-in user and their current workspace, checked against the database on every request
 * (once per request), so removing someone from a workspace takes effect immediately.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  const data = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (typeof data.exp !== "number" || data.exp < Date.now() / 1000) return null;
  const role = await roleIn(data.userId, data.tenantId);
  if (role) return { userId: data.userId, tenantId: data.tenantId, role };
  // No longer in that workspace: fall back to one they still belong to.
  const [other] = await sql<{ tenant_id: string; role: Role }[]>`
    SELECT tenant_id, role FROM memberships WHERE user_id = ${data.userId} ORDER BY created_at LIMIT 1`;
  return other ? { userId: data.userId, tenantId: other.tenant_id, role: other.role } : null;
});

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export function hasRole(session: Session, minimum: Role): boolean {
  return RANK[session.role] >= RANK[minimum];
}

/** For workspace settings (team, API keys, branding): owners and admins only. */
export async function requireRole(minimum: Role): Promise<Session> {
  const session = await requireSession();
  if (!hasRole(session, minimum)) notFound();
  return session;
}

/** Authenticates calls from the agent worker to /api/internal/*. */
export function isInternalRequest(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${process.env.INTERNAL_API_TOKEN}`);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export type AdminSession = Session & { email: string };

function envAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Platform owner check: users flagged in the database, or listed in PLATFORM_ADMIN_EMAILS. */
export async function getAdminSession(): Promise<AdminSession | null> {
  const session = await getSession();
  if (!session) return null;
  const [user] = await sql<{ email: string; is_platform_admin: boolean }[]>`
    SELECT email, is_platform_admin FROM users WHERE id = ${session.userId}`;
  if (!user) return null;
  if (!user.is_platform_admin && !envAdminEmails().includes(user.email)) return null;
  return { ...session, email: user.email };
}

/** For admin pages: anyone who isn't a platform admin gets a 404, so the panel stays hidden. */
export async function requireAdmin(): Promise<AdminSession> {
  const admin = await getAdminSession();
  if (!admin) notFound();
  return admin;
}

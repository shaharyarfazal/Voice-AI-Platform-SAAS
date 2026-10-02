import "server-only";
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { sql } from "./db";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const SESSION_COOKIE = "session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

export type Session = { userId: string; tenantId: string };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

function sign(value: string): string {
  return createHmac("sha256", process.env.SESSION_SECRET!).update(value).digest("base64url");
}

export async function createSession(session: Session): Promise<void> {
  const payload = Buffer.from(
    JSON.stringify({ ...session, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }),
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

export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  const data = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (typeof data.exp !== "number" || data.exp < Date.now() / 1000) return null;
  return { userId: data.userId, tenantId: data.tenantId };
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
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

"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession, destroySession, hashPassword, verifyPassword } from "@/lib/auth";
import { createAccount } from "@/lib/accounts";
import { sql } from "@/lib/db";
import { getSettings } from "@/lib/settings";

export type AuthState = { error?: string } | undefined;

/** Only same-site paths, so a crafted link can't send people elsewhere after signing in. */
function safeNext(v: FormDataEntryValue | null): string | null {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\") ? s : null;
}

const Credentials = z.object({
  email: z.email().transform((e) => e.toLowerCase().trim()),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function signup(_: AuthState, form: FormData): Promise<AuthState> {
  const settings = await getSettings();
  if (!settings.allowSignup) return { error: "Sign-ups are closed. Contact us for an account." };
  if ((settings.termsUrl || settings.privacyUrl) && form.get("terms") !== "on") {
    return { error: "Please accept the terms to create an account." };
  }
  const parsed = Credentials.extend({
    name: z.string().trim().min(1, "Your name is required").max(100),
    company: z.string().trim().min(1, "Business name is required").max(200),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { email, password, company, name } = parsed.data;

  const [existing] = await sql`SELECT 1 FROM users WHERE email = ${email}`;
  if (existing) return { error: "An account with this email already exists" };

  const passwordHash = await hashPassword(password);
  const termsAcceptedAt = form.get("terms") === "on" ? new Date() : null;
  const account = await sql.begin((tx) => createAccount(tx, { email, name, passwordHash, company, termsAcceptedAt }));
  await createSession(account);
  redirect(safeNext(form.get("next")) ?? "/onboarding");
}

export async function login(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = Credentials.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Invalid email or password" };

  const [user] = await sql`SELECT id, tenant_id, password_hash FROM users WHERE email = ${parsed.data.email}`;
  if (!user || !(await verifyPassword(parsed.data.password, user.password_hash))) {
    return { error: "Invalid email or password" };
  }

  await sql`UPDATE users SET last_login_at = now() WHERE id = ${user.id}`;
  await createSession({ userId: user.id, tenantId: user.tenant_id });
  redirect(safeNext(form.get("next")) ?? "/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

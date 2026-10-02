"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession, destroySession, hashPassword, verifyPassword } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getSettings } from "@/lib/settings";

export type AuthState = { error?: string } | undefined;

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
  const parsed = Credentials.extend({ company: z.string().trim().min(1, "Company name is required") }).safeParse(
    Object.fromEntries(form),
  );
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { email, password, company } = parsed.data;

  const [existing] = await sql`SELECT 1 FROM users WHERE email = ${email}`;
  if (existing) return { error: "An account with this email already exists" };

  const passwordHash = await hashPassword(password);
  const termsAcceptedAt = form.get("terms") === "on" ? new Date() : null;
  const [user] = await sql.begin(async (tx) => {
    const [tenant] = await tx`INSERT INTO tenants (name) VALUES (${company}) RETURNING id`;
    return tx`INSERT INTO users (tenant_id, email, password_hash, terms_accepted_at, last_login_at)
              VALUES (${tenant.id}, ${email}, ${passwordHash}, ${termsAcceptedAt}, now()) RETURNING id, tenant_id`;
  });

  await createSession({ userId: user.id, tenantId: user.tenant_id });
  redirect("/");
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
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

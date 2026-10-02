"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession, destroySession, hashPassword, verifyPassword } from "@/lib/auth";
import { sql } from "@/lib/db";

export type AuthState = { error?: string } | undefined;

const Credentials = z.object({
  email: z.email().transform((e) => e.toLowerCase().trim()),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function signup(_: AuthState, form: FormData): Promise<AuthState> {
  if (process.env.ALLOW_SIGNUP === "false") return { error: "Sign-ups are closed. Contact us for an account." };
  const parsed = Credentials.extend({ company: z.string().trim().min(1, "Company name is required") }).safeParse(
    Object.fromEntries(form),
  );
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { email, password, company } = parsed.data;

  const [existing] = await sql`SELECT 1 FROM users WHERE email = ${email}`;
  if (existing) return { error: "An account with this email already exists" };

  const passwordHash = await hashPassword(password);
  const [user] = await sql.begin(async (tx) => {
    const [tenant] = await tx`INSERT INTO tenants (name) VALUES (${company}) RETURNING id`;
    return tx`INSERT INTO users (tenant_id, email, password_hash)
              VALUES (${tenant.id}, ${email}, ${passwordHash}) RETURNING id, tenant_id`;
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

  await createSession({ userId: user.id, tenantId: user.tenant_id });
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

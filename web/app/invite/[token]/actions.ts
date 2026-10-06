"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession, getSession, hashPassword } from "@/lib/auth";
import { sql } from "@/lib/db";

export type AcceptState = { error?: string } | undefined;

type Invite = { id: string; tenant_id: string; email: string; role: string };

export async function findInvite(token: string): Promise<(Invite & { workspace: string }) | null> {
  const [row] = await sql<(Invite & { workspace: string })[]>`
    SELECT i.id, i.tenant_id, i.email, i.role, t.name AS workspace FROM invites i JOIN tenants t ON t.id = i.tenant_id
    WHERE i.token_hash = ${createHash("sha256").update(token).digest("hex")} AND i.accepted_at IS NULL AND i.expires_at > now()`;
  return row ?? null;
}

async function join(invite: Invite, userId: string) {
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO memberships (tenant_id, user_id, role) VALUES (${invite.tenant_id}, ${userId}, ${invite.role})
      ON CONFLICT (tenant_id, user_id) DO NOTHING`;
    await tx`UPDATE invites SET accepted_at = now() WHERE id = ${invite.id}`;
  });
  await createSession({ userId, tenantId: invite.tenant_id });
}

/** Signed in with the invited email: join the workspace. */
export async function acceptInvite(token: string) {
  const session = await getSession();
  const invite = await findInvite(token);
  if (!session || !invite) redirect(`/invite/${token}`);
  const [user] = await sql<{ email: string }[]>`SELECT email FROM users WHERE id = ${session.userId}`;
  if (user?.email !== invite.email) redirect(`/invite/${token}`);
  await join(invite, session.userId);
  redirect("/");
}

/** New to the platform: create the person's login and join in one step. */
export async function acceptAsNewUser(token: string, _: AcceptState, form: FormData): Promise<AcceptState> {
  const invite = await findInvite(token);
  if (!invite) return { error: "This invite has expired or was already used. Ask for a new one." };
  const parsed = z
    .object({ name: z.string().trim().min(1, "Enter your name").max(100), password: z.string().min(8, "Password must be at least 8 characters") })
    .safeParse({ name: form.get("name"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const [existing] = await sql`SELECT 1 FROM users WHERE email = ${invite.email}`;
  if (existing) return { error: "You already have an account. Sign in to accept." };
  const passwordHash = await hashPassword(parsed.data.password);
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (tenant_id, email, name, password_hash, last_login_at)
    VALUES (${invite.tenant_id}, ${invite.email}, ${parsed.data.name}, ${passwordHash}, now()) RETURNING id`;
  await join(invite, user.id);
  redirect("/");
}

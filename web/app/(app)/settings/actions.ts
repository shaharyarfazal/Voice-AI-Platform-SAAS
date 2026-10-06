"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createApiKeySecret } from "@/lib/api-keys";
import { createSession, requireRole, requireSession, roleIn } from "@/lib/auth";
import { sql } from "@/lib/db";
import { workspaceUrl } from "@/lib/urls";
import { isUuid } from "@/lib/validation";
import { BrandingSchema, isTopLevel } from "@/lib/workspace";

export type FormState = { error?: string; saved?: boolean } | undefined;

// ---- Switching and workspace details ----

export async function switchWorkspace(form: FormData) {
  const session = await requireSession();
  const id = form.get("tenantId")?.toString();
  if (!isUuid(id) || !(await roleIn(session.userId, id))) return;
  await createSession({ userId: session.userId, tenantId: id });
  redirect("/");
}

export async function updateWorkspace(_: FormState, form: FormData): Promise<FormState> {
  const { tenantId } = await requireRole("admin");
  const parsed = z
    .object({
      name: z.string().trim().min(1, "Name the workspace").max(200),
      website: z.union([z.literal(""), z.url("Enter the full website address, like https://example.com")]),
    })
    .safeParse({ name: form.get("name"), website: form.get("website")?.toString().trim() ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await sql`UPDATE tenants SET name = ${parsed.data.name}, website = ${parsed.data.website || null} WHERE id = ${tenantId}`;
  revalidatePath("/", "layout");
  return { saved: true };
}

// ---- Team ----

export type InviteState = { error?: string; links?: { email: string; url: string }[] } | undefined;

const INVITE_DAYS = 7;

export async function inviteMembers(_: InviteState, form: FormData): Promise<InviteState> {
  const session = await requireRole("admin");
  const role = form.get("role") === "admin" ? "admin" : "member";
  const emails = [...new Set((form.get("emails")?.toString() ?? "").split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (emails.length === 0) return { error: "Enter at least one email address." };
  if (emails.length > 50) return { error: "Invite up to 50 people at a time." };
  const bad = emails.find((e) => !z.email().safeParse(e).success);
  if (bad) return { error: `"${bad}" isn't an email address.` };

  const base = await workspaceUrl(session.tenantId);
  const links: { email: string; url: string }[] = [];
  for (const email of emails) {
    const [member] = await sql`
      SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ${session.tenantId} AND u.email = ${email}`;
    if (member) continue;
    const token = randomBytes(24).toString("base64url");
    await sql`DELETE FROM invites WHERE tenant_id = ${session.tenantId} AND email = ${email} AND accepted_at IS NULL`;
    await sql`
      INSERT INTO invites (tenant_id, email, role, token_hash, invited_by, expires_at)
      VALUES (${session.tenantId}, ${email}, ${role}, ${createHash("sha256").update(token).digest("hex")}, ${session.userId},
              now() + make_interval(days => ${INVITE_DAYS}))`;
    links.push({ email, url: `${base}/invite/${token}` });
  }
  revalidatePath("/settings/team");
  return links.length ? { links } : { error: "Everyone you entered is already in this workspace." };
}

export async function revokeInvite(form: FormData) {
  const { tenantId } = await requireRole("admin");
  const id = form.get("id")?.toString();
  if (isUuid(id)) await sql`DELETE FROM invites WHERE id = ${id} AND tenant_id = ${tenantId}`;
  revalidatePath("/settings/team");
}

export async function changeRole(form: FormData) {
  const session = await requireRole("admin");
  const userId = form.get("userId")?.toString();
  const role = form.get("role")?.toString();
  if (!isUuid(userId) || !["owner", "admin", "member"].includes(role ?? "")) return;
  // Only owners hand out or take away ownership.
  const [target] = await sql<{ role: string }[]>`SELECT role FROM memberships WHERE tenant_id = ${session.tenantId} AND user_id = ${userId}`;
  if (!target || ((role === "owner" || target.role === "owner") && session.role !== "owner")) return;
  if (target.role === "owner" && role !== "owner" && (await ownerCount(session.tenantId)) <= 1) return;
  await sql`UPDATE memberships SET role = ${role!} WHERE tenant_id = ${session.tenantId} AND user_id = ${userId}`;
  revalidatePath("/settings/team");
}

export async function removeMember(form: FormData) {
  const session = await requireRole("admin");
  const userId = form.get("userId")?.toString();
  if (!isUuid(userId)) return;
  const [target] = await sql<{ role: string }[]>`SELECT role FROM memberships WHERE tenant_id = ${session.tenantId} AND user_id = ${userId}`;
  if (!target || (target.role === "owner" && (session.role !== "owner" || (await ownerCount(session.tenantId)) <= 1))) return;
  await sql`DELETE FROM memberships WHERE tenant_id = ${session.tenantId} AND user_id = ${userId}`;
  revalidatePath("/settings/team");
}

async function ownerCount(tenantId: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM memberships WHERE tenant_id = ${tenantId} AND role = 'owner'`;
  return row.n;
}

// ---- API keys ----

export type ApiKeyState = { error?: string; key?: string; name?: string } | undefined;

const EXPIRY_DAYS: Record<string, number | null> = { "30": 30, "90": 90, "365": 365, never: null };

export async function createApiKey(_: ApiKeyState, form: FormData): Promise<ApiKeyState> {
  const session = await requireRole("admin");
  const name = form.get("name")?.toString().trim() ?? "";
  if (!name || name.length > 100) return { error: "Name the key, e.g. \"Zapier\" or \"Production server\"." };
  const expiry = form.get("expiry")?.toString() ?? "90";
  if (!(expiry in EXPIRY_DAYS)) return { error: "Pick when the key expires." };
  const days = EXPIRY_DAYS[expiry];
  const { key, prefix, hash } = createApiKeySecret();
  await sql`
    INSERT INTO api_keys (tenant_id, name, prefix, key_hash, created_by, expires_at)
    VALUES (${session.tenantId}, ${name}, ${prefix}, ${hash}, ${session.userId},
            ${days === null ? null : sql`now() + make_interval(days => ${days})`})`;
  revalidatePath("/settings/api-keys");
  return { key, name };
}

export async function revokeApiKey(form: FormData) {
  const { tenantId } = await requireRole("admin");
  const id = form.get("id")?.toString();
  if (isUuid(id)) await sql`UPDATE api_keys SET revoked_at = now() WHERE id = ${id} AND tenant_id = ${tenantId} AND revoked_at IS NULL`;
  revalidatePath("/settings/api-keys");
}

// ---- Sub-accounts and branding (agencies) ----

export async function createSubAccount(_: InviteState, form: FormData): Promise<InviteState> {
  const session = await requireRole("admin");
  if (!(await isTopLevel(session.tenantId))) return { error: "Sub-accounts can't have their own sub-accounts." };
  const name = form.get("name")?.toString().trim() ?? "";
  if (!name || name.length > 200) return { error: "Name the client's workspace." };
  const email = form.get("email")?.toString().trim().toLowerCase() ?? "";
  if (email && !z.email().safeParse(email).success) return { error: `"${email}" isn't an email address.` };

  const [child] = await sql<{ id: string }[]>`INSERT INTO tenants (name, parent_id) VALUES (${name}, ${session.tenantId}) RETURNING id`;
  if (!email) {
    revalidatePath("/settings/sub-accounts");
    return { links: [] };
  }
  const token = randomBytes(24).toString("base64url");
  await sql`
    INSERT INTO invites (tenant_id, email, role, token_hash, invited_by, expires_at)
    VALUES (${child.id}, ${email}, 'admin', ${createHash("sha256").update(token).digest("hex")}, ${session.userId},
            now() + make_interval(days => ${INVITE_DAYS}))`;
  revalidatePath("/settings/sub-accounts");
  return { links: [{ email, url: `${await workspaceUrl(child.id)}/invite/${token}` }] };
}

export async function saveBranding(_: FormState, form: FormData): Promise<FormState> {
  const session = await requireRole("admin");
  if (!(await isTopLevel(session.tenantId))) return { error: "Branding is set by your agency." };
  const parsed = BrandingSchema.safeParse({
    name: form.get("name")?.toString() ?? "",
    logoUrl: form.get("logoUrl")?.toString().trim() ?? "",
    accentColor: form.get("accentColor")?.toString().trim() ?? "",
    supportEmail: form.get("supportEmail")?.toString().trim() ?? "",
    hidePoweredBy: form.get("hidePoweredBy") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const domain = (form.get("customDomain")?.toString() ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (domain && !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain)) return { error: "Enter a domain like app.youragency.com" };
  const [taken] = domain ? await sql`SELECT 1 FROM tenants WHERE custom_domain = ${domain} AND id <> ${session.tenantId}` : [];
  if (taken) return { error: "That domain is already used by another workspace." };
  await sql`UPDATE tenants SET branding = ${sql.json(parsed.data)}, custom_domain = ${domain || null} WHERE id = ${session.tenantId}`;
  revalidatePath("/", "layout");
  return { saved: true };
}

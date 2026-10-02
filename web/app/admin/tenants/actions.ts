"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { hashPassword, requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/validation";

export type FormState = { error?: string; saved?: boolean } | undefined;

const NewClient = z.object({
  company: z.string().trim().min(1, "Company name is required"),
  email: z.email("Enter a valid email").transform((e) => e.toLowerCase().trim()),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

/** Creates a client account with its first user, for when public sign-up is closed. */
export async function createClient(_: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = NewClient.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { company, email, password } = parsed.data;

  const [existing] = await sql`SELECT 1 FROM users WHERE email = ${email}`;
  if (existing) return { error: "A user with this email already exists" };

  const passwordHash = await hashPassword(password);
  const [tenant] = await sql.begin(async (tx) => {
    const created = await tx`INSERT INTO tenants (name) VALUES (${company}) RETURNING id`;
    await tx`INSERT INTO users (tenant_id, email, password_hash) VALUES (${created[0].id}, ${email}, ${passwordHash})`;
    return created;
  });
  redirect(`/admin/tenants/${tenant.id}`);
}

const ClientSettings = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, "Name is required"),
  status: z.enum(["active", "suspended"]),
  pricePerMinute: z.coerce.number().min(0, "Price can't be negative"),
  monthlyFee: z.coerce.number().min(0, "Fee can't be negative"),
  monthlyMinuteLimit: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0), "Minute limit must be a whole number"),
  transcriptRetentionDays: z.coerce.number().int().min(1, "Keep transcripts at least 1 day").max(3650),
  notes: z.string().max(5000),
});

export async function updateClient(_: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = ClientSettings.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const c = parsed.data;
  await sql`
    UPDATE tenants SET name = ${c.name}, status = ${c.status}, price_per_minute = ${c.pricePerMinute},
      monthly_fee = ${c.monthlyFee}, monthly_minute_limit = ${c.monthlyMinuteLimit},
      transcript_retention_days = ${c.transcriptRetentionDays}, notes = ${c.notes}
    WHERE id = ${c.id}`;
  revalidatePath(`/admin/tenants/${c.id}`);
  return { saved: true };
}

export async function deleteClient(form: FormData) {
  const admin = await requireAdmin();
  const id = form.get("id")?.toString();
  if (!isUuid(id)) return;
  if (id === admin.tenantId) throw new Error("You can't delete your own account's client.");
  // Cascades to users, agents, phone numbers and call history, so the name must be typed to confirm.
  const deleted = await sql`
    DELETE FROM tenants WHERE id = ${id} AND name = ${form.get("confirm")?.toString().trim() ?? ""} RETURNING id`;
  redirect(deleted.length > 0 ? "/admin/tenants" : `/admin/tenants/${id}?delete=mismatch`);
}

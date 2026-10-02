"use server";

import { revalidatePath } from "next/cache";
import { hashPassword, requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/validation";

export type UserActionState = { error?: string; message?: string } | undefined;

export async function setAdmin(form: FormData) {
  const admin = await requireAdmin();
  const id = form.get("id")?.toString();
  if (!isUuid(id) || id === admin.userId) return; // can't demote yourself and lock yourself out
  await sql`UPDATE users SET is_platform_admin = ${form.get("value") === "true"} WHERE id = ${id}`;
  revalidatePath("/admin/users");
}

export async function resetPassword(_: UserActionState, form: FormData): Promise<UserActionState> {
  await requireAdmin();
  const id = form.get("id")?.toString();
  const password = form.get("password")?.toString() ?? "";
  if (!isUuid(id)) return { error: "Unknown user" };
  if (password.length < 8) return { error: "At least 8 characters" };
  await sql`UPDATE users SET password_hash = ${await hashPassword(password)} WHERE id = ${id}`;
  return { message: "Password changed" };
}

export async function deleteUser(form: FormData) {
  const admin = await requireAdmin();
  const id = form.get("id")?.toString();
  if (!isUuid(id) || id === admin.userId) return;
  await sql`DELETE FROM users WHERE id = ${id}`;
  revalidatePath("/admin/users");
}

"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/validation";

export async function disconnectIntegration(form: FormData) {
  const { tenantId } = await requireSession();
  const id = form.get("id")?.toString();
  if (!isUuid(id)) return;
  // Agents using this calendar stop offering booking until another calendar is chosen.
  await sql`DELETE FROM integrations WHERE id = ${id} AND tenant_id = ${tenantId}`;
  revalidatePath("/integrations");
}

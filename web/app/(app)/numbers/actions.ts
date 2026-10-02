"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { isE164, isUuid } from "@/lib/validation";

export type NumberFormState = { error?: string } | undefined;

const NumberInput = z.object({
  e164: z.string().trim().refine(isE164, "Enter the number in E.164 format, e.g. +14155550100"),
  carrier: z.enum(["telnyx", "twilio"]),
  agentId: z.string().transform((v) => (isUuid(v) ? v : null)),
});

export async function addNumber(_: NumberFormState, form: FormData): Promise<NumberFormState> {
  const { tenantId } = await requireSession();
  const parsed = NumberInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { e164, carrier, agentId } = parsed.data;

  const [taken] = await sql`SELECT 1 FROM phone_numbers WHERE e164 = ${e164}`;
  if (taken) return { error: "This number is already registered" };

  await sql`
    INSERT INTO phone_numbers (tenant_id, e164, carrier, agent_id)
    SELECT ${tenantId}, ${e164}, ${carrier}, ${agentId}
    WHERE ${agentId}::uuid IS NULL
       OR EXISTS (SELECT 1 FROM agents WHERE id = ${agentId} AND tenant_id = ${tenantId})`;
  revalidatePath("/numbers");
}

export async function assignAgent(form: FormData) {
  const { tenantId } = await requireSession();
  const id = form.get("id")?.toString();
  const raw = form.get("agentId")?.toString();
  const agentId = isUuid(raw) ? raw : null;
  if (!isUuid(id)) return;
  // The agent must belong to the same tenant as the number.
  await sql`
    UPDATE phone_numbers SET agent_id = ${agentId}
    WHERE id = ${id} AND tenant_id = ${tenantId}
      AND (${agentId}::uuid IS NULL
           OR EXISTS (SELECT 1 FROM agents WHERE id = ${agentId} AND tenant_id = ${tenantId}))`;
  revalidatePath("/numbers");
}

export async function removeNumber(form: FormData) {
  const { tenantId } = await requireSession();
  const id = form.get("id")?.toString();
  if (isUuid(id)) await sql`DELETE FROM phone_numbers WHERE id = ${id} AND tenant_id = ${tenantId}`;
  revalidatePath("/numbers");
}

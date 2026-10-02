"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { isE164, isUuid } from "@/lib/validation";

export type AgentFormState = { error?: string; saved?: boolean } | undefined;

const AgentInput = z.object({
  name: z.string().trim().min(1, "Name is required"),
  greeting: z.string().trim().min(1, "Greeting is required"),
  systemPrompt: z.string().trim().min(1, "Instructions are required"),
  voiceId: z.string().trim().min(1, "Voice ID is required"),
  language: z.string().trim().min(2),
  llmModel: z.string().trim().min(1),
  transferNumber: z
    .string()
    .trim()
    .transform((v) => v || null)
    .refine((v) => v === null || isE164(v), "Transfer number must be in E.164 format, e.g. +14155550100"),
  announceAi: z.literal("on").optional().transform((v) => v === "on"),
});

export async function saveAgent(_: AgentFormState, form: FormData): Promise<AgentFormState> {
  const { tenantId } = await requireSession();
  const parsed = AgentInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const a = parsed.data;
  const id = form.get("id")?.toString();

  if (isUuid(id)) {
    await sql`
      UPDATE agents SET name = ${a.name}, greeting = ${a.greeting}, system_prompt = ${a.systemPrompt},
        voice_id = ${a.voiceId}, language = ${a.language}, llm_model = ${a.llmModel},
        transfer_number = ${a.transferNumber}, announce_ai = ${a.announceAi}, updated_at = now()
      WHERE id = ${id} AND tenant_id = ${tenantId}`;
    revalidatePath(`/agents/${id}`);
    return { saved: true };
  }

  const [created] = await sql`
    INSERT INTO agents (tenant_id, name, greeting, system_prompt, voice_id, language, llm_model, transfer_number, announce_ai)
    VALUES (${tenantId}, ${a.name}, ${a.greeting}, ${a.systemPrompt}, ${a.voiceId}, ${a.language},
            ${a.llmModel}, ${a.transferNumber}, ${a.announceAi})
    RETURNING id`;
  redirect(`/agents/${created.id}`);
}

export async function deleteAgent(form: FormData) {
  const { tenantId } = await requireSession();
  const id = form.get("id")?.toString();
  if (isUuid(id)) await sql`DELETE FROM agents WHERE id = ${id} AND tenant_id = ${tenantId}`;
  redirect("/agents");
}

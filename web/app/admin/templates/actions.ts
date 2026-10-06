"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { DEFAULT_TEMPLATES, saveTemplates, TemplatesSchema } from "@/lib/templates";

export type TemplateState = { error?: string; saved?: boolean } | undefined;

export async function updateTemplates(_: TemplateState, form: FormData): Promise<TemplateState> {
  await requireAdmin();
  const get = (k: string) => form.get(k)?.toString() ?? "";
  const parsed = TemplatesSchema.safeParse({
    inbound: { name: get("inbound.name"), greeting: get("inbound.greeting"), prompt: get("inbound.prompt") },
    outbound: { name: get("outbound.name"), greeting: get("outbound.greeting"), prompt: get("outbound.prompt") },
    chat: { name: get("chat.name"), greeting: get("chat.greeting"), prompt: get("chat.prompt") },
  });
  if (!parsed.success) return { error: "A template is too long." };
  await saveTemplates(parsed.data);
  revalidatePath("/admin/templates");
  return { saved: true };
}

export async function resetTemplates() {
  await requireAdmin();
  await saveTemplates(DEFAULT_TEMPLATES);
  revalidatePath("/admin/templates");
}

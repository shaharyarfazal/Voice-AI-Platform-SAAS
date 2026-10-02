"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { saveSettings } from "@/lib/settings";

export type SettingsState = { error?: string; saved?: boolean } | undefined;

const rate = z.coerce.number().min(0, "Rates can't be negative");
const url = z.string().trim().refine((v) => v === "" || /^https?:\/\//.test(v), "Links must start with https://");

const Settings = z.object({
  allowSignup: z.literal("on").optional().transform((v) => v === "on"),
  disclosure: z.string().trim().max(500),
  safetyInstructions: z.string().trim().max(4000),
  apologyMessage: z.string().trim().min(1, "The apology message can't be empty").max(500),
  termsUrl: url,
  privacyUrl: url,
  sttPerMinute: rate,
  llmInputPerMillion: rate,
  llmOutputPerMillion: rate,
  ttsPerThousandChars: rate,
  telephonyPerMinute: rate,
  serverMonthly: rate,
});

export async function updateSettings(_: SettingsState, form: FormData): Promise<SettingsState> {
  await requireAdmin();
  const parsed = Settings.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const s = parsed.data;
  await saveSettings({
    allowSignup: s.allowSignup,
    disclosure: s.disclosure,
    safetyInstructions: s.safetyInstructions,
    apologyMessage: s.apologyMessage,
    termsUrl: s.termsUrl,
    privacyUrl: s.privacyUrl,
    rates: {
      sttPerMinute: s.sttPerMinute,
      llmInputPerMillion: s.llmInputPerMillion,
      llmOutputPerMillion: s.llmOutputPerMillion,
      ttsPerThousandChars: s.ttsPerThousandChars,
      telephonyPerMinute: s.telephonyPerMinute,
      serverMonthly: s.serverMonthly,
    },
  });
  revalidatePath("/admin", "layout");
  return { saved: true };
}

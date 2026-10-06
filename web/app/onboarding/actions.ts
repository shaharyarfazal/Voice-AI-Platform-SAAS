"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { LANGUAGES } from "@/lib/catalog";
import { sql } from "@/lib/db";
import { addSource } from "@/lib/knowledge/ingest";
import { assertPublicUrl } from "@/lib/net";
import { finishOnboarding } from "@/lib/onboarding";

export type StepState = { error?: string; ok?: boolean; kbId?: string } | undefined;

const Business = z.object({
  name: z.string().trim().min(1, "Enter your business name").max(200),
  industry: z.string().trim().max(80),
  website: z.string().trim().max(300),
  phone: z.string().trim().max(30).refine((v) => v === "" || /^\+[1-9]\d{6,14}$/.test(v.replace(/[\s()-]/g, "")), "Phone numbers need the country code, like +14155550100"),
  language: z.string().refine((l) => LANGUAGES.some((x) => x.code === l), "Pick a language"),
  timezone: z.string().max(60),
});

export async function saveBusiness(_: StepState, form: FormData): Promise<StepState> {
  const { tenantId } = await requireRole("admin");
  const parsed = Business.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const b = parsed.data;
  let website: string | null = null;
  if (b.website) {
    website = /^https?:\/\//i.test(b.website) ? b.website : `https://${b.website}`;
    try {
      await assertPublicUrl(website, { allowHttp: true });
    } catch {
      return { error: "That website address doesn't work. Check it, or leave it empty." };
    }
  }
  await sql`
    UPDATE tenants SET name = ${b.name}, website = ${website},
      profile = ${sql.json({ industry: b.industry, phone: b.phone.replace(/[\s()-]/g, ""), language: b.language, timezone: b.timezone || "UTC" })}
    WHERE id = ${tenantId}`;
  return { ok: true };
}

async function onboardingKb(tenantId: string): Promise<string> {
  const [kb] = await sql<{ id: string }[]>`SELECT id FROM knowledge_bases WHERE tenant_id = ${tenantId} ORDER BY created_at LIMIT 1`;
  if (kb) return kb.id;
  const [created] = await sql<{ id: string }[]>`INSERT INTO knowledge_bases (tenant_id, name) VALUES (${tenantId}, 'Business knowledge') RETURNING id`;
  return created.id;
}

/** Knowledge step: read the website and/or keep a description; files upload separately to this KB. */
export async function saveKnowledge(_: StepState, form: FormData): Promise<StepState> {
  const { tenantId } = await requireRole("admin");
  const kbId = await onboardingKb(tenantId);
  const [t] = await sql<{ website: string | null }[]>`SELECT website FROM tenants WHERE id = ${tenantId}`;
  const description = form.get("description")?.toString().trim() ?? "";
  const readSite = form.get("readWebsite") === "on" && t?.website;
  const [already] = await sql`SELECT 1 FROM kb_sources WHERE kb_id = ${kbId} AND kind = 'website'`;
  if (readSite && !already) await addSource(tenantId, kbId, { kind: "website", title: new URL(t.website!).hostname, url: t.website!, maxPages: 40 });
  if (description.length >= 20) await addSource(tenantId, kbId, { kind: "text", title: "About the business", content: description });
  return { ok: true, kbId };
}

export async function ensureKb(): Promise<string> {
  const { tenantId } = await requireRole("admin");
  return onboardingKb(tenantId);
}

export type BuildStatus = { sources: { title: string; status: string; pages: number; error: string | null }[]; done: boolean };

export async function buildStatus(): Promise<BuildStatus> {
  const { tenantId } = await requireRole("admin");
  const sources = await sql<BuildStatus["sources"]>`
    SELECT title, status, pages, error FROM kb_sources WHERE tenant_id = ${tenantId} ORDER BY created_at`;
  return { sources: [...sources], done: sources.every((s) => s.status === "ready" || s.status === "error") };
}

export async function finish() {
  const { tenantId } = await requireRole("admin");
  await finishOnboarding(tenantId);
  redirect("/?welcome=1");
}

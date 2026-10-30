"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, requireSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import * as numbers from "@/lib/phone-numbers";
import { rateLimit } from "@/lib/rate-limit";
import { searchNumbers, SELL_COUNTRIES, twilioStatus, type AvailableNumber } from "@/lib/twilio";
import { isE164, isUuid } from "@/lib/validation";

const agentField = z.string().optional().transform((v) => (isUuid(v) ? v : null));

export type SearchState = { error?: string; results?: AvailableNumber[] } | undefined;

const Search = z.object({
  country: z.enum(SELL_COUNTRIES.map((c) => c.code) as [string, ...string[]]),
  areaCode: z.string().trim().regex(/^\d{0,3}$/, "Area codes are 3 digits"),
  contains: z.string().trim().regex(/^[\d*]{0,7}$/, "Use digits only"),
});

export async function searchAvailable(_: SearchState, form: FormData): Promise<SearchState> {
  const { tenantId } = await requireRole("admin");
  if (!twilioStatus().sell) return { error: "Buying numbers isn't available yet." };
  const parsed = Search.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!rateLimit(`num-search:${tenantId}`, 30, 60_000)) return { error: "Too many searches. Wait a minute." };
  try {
    const results = await searchNumbers(parsed.data.country, { areaCode: parsed.data.areaCode || undefined, contains: parsed.data.contains || undefined });
    return results.length ? { results } : { error: "No numbers available there. Try another area code, or leave it empty." };
  } catch (e) {
    console.error("twilio: search failed", e);
    return { error: "Searching for numbers failed. Try again." };
  }
}

export type BuyState = { error?: string; bought?: string } | undefined;

export async function buy(_: BuyState, form: FormData): Promise<BuyState> {
  const { tenantId } = await requireRole("admin");
  if (!twilioStatus().sell) return { error: "Buying numbers isn't available yet." };
  const e164 = form.get("e164")?.toString() ?? "";
  if (!isE164(e164)) return { error: "Pick a number from the list." };
  if (!rateLimit(`num-buy:${tenantId}`, 5, 60 * 60_000)) return { error: "Up to 5 numbers an hour. Try again later." };
  const result = await numbers.purchaseNumber(tenantId, e164, agentField.parse(form.get("agentId")?.toString()));
  if (!result.ok) return { error: result.error };
  revalidatePath("/numbers");
  return { bought: e164 };
}

export type VerifyState = { error?: string; id?: string; code?: string; e164?: string } | undefined;

const Own = z.object({
  e164: z.string().transform((v) => v.replace(/[\s()-]/g, "")).refine(isE164, "Enter the number with its country code, like +14155550100"),
  carrier: z.enum(["twilio", "telnyx", "other"]),
});

export async function startVerify(_: VerifyState, form: FormData): Promise<VerifyState> {
  const { tenantId } = await requireRole("admin");
  if (!twilioStatus().verify) return { error: "Connecting your own number isn't available yet." };
  const parsed = Own.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  // Each attempt phones someone: keep it to a handful, per workspace and per number.
  if (!rateLimit(`num-verify:${tenantId}`, 5, 60 * 60_000) || !rateLimit(`num-verify:${parsed.data.e164}`, 3, 60 * 60_000)) {
    return { error: "Too many verification calls. Try again in an hour." };
  }
  const [{ pending }] = await sql<{ pending: number }[]>`
    SELECT count(*)::int AS pending FROM phone_numbers WHERE tenant_id = ${tenantId} AND status = 'pending' AND verify_expires_at > now() AND e164 <> ${parsed.data.e164}`;
  if (pending >= 3) return { error: "Finish verifying the numbers you've started first." };
  const result = await numbers.startVerification(tenantId, parsed.data.e164, parsed.data.carrier, agentField.parse(form.get("agentId")?.toString()));
  if (!result.ok) return { error: result.error };
  revalidatePath("/numbers");
  return { id: result.id, code: result.code, e164: parsed.data.e164 };
}

export async function verificationState(id: string): Promise<numbers.VerificationState> {
  const { tenantId } = await requireRole("admin");
  if (!isUuid(id)) return "gone";
  const state = await numbers.checkVerification(tenantId, id);
  if (state === "verified") revalidatePath("/numbers");
  return state;
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
  const { tenantId } = await requireRole("admin");
  const id = form.get("id")?.toString();
  if (isUuid(id)) await numbers.removeNumber(tenantId, id);
  revalidatePath("/numbers");
}

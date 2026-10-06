"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  BookingSchema,
  CustomFunctionSchema,
  GuardrailsSchema,
  isValidTimezone,
  McpServerSchema,
  parseTools,
  PostCallSchema,
} from "@/lib/agent-settings";
import { requireSession } from "@/lib/auth";
import { findProvider, LANGUAGES } from "@/lib/catalog";
import { duplicateAgent, importAgent } from "@/lib/agent-io";
import { encrypt } from "@/lib/crypto";
import { elevenLabsVoiceExists } from "@/lib/elevenlabs";
import { sql } from "@/lib/db";
import { assertPublicHttpsUrl } from "@/lib/net";
import { isE164, isUuid } from "@/lib/validation";
import { postWebhook, sampleCall, webhookSecret } from "@/lib/webhooks";

export type AgentFormState = { error?: string; saved?: boolean } | undefined;

const Choice = (role: "stt" | "llm" | "tts") =>
  z
    .object({ provider: z.string(), model: z.string().trim().max(100), voice: z.string().trim().max(200).optional() })
    .refine((c) => findProvider(role, c.provider), `Unknown ${role.toUpperCase()} provider`);

// Secrets come in as plain text only when changed; "keep" reuses the stored encrypted value.
const SecretInput = { authorization: z.string().max(2000).optional(), keepAuthorization: z.boolean().default(false) };

const Payload = z.object({
  type: z.enum(["inbound", "outbound", "chat"]).default("inbound"),
  knowledgeBaseIds: z.array(z.uuid()).max(10).default([]),
  name: z.string().trim().min(1, "Give the agent a name").max(100),
  greeting: z.string().trim().min(1, "The greeting can't be empty").max(500),
  systemPrompt: z.string().trim().min(1, "Instructions can't be empty").max(20000),
  announceAi: z.boolean(),
  language: z.string().refine((l) => LANGUAGES.some((x) => x.code === l), "Pick a language"),
  providers: z.object({
    mode: z.enum(["pipeline", "realtime"]).default("pipeline"),
    stt: Choice("stt"),
    llm: Choice("llm"),
    tts: Choice("tts"),
    realtime: z.object({ model: z.string().trim().min(1, "Pick a Realtime model").max(100), voice: z.string().trim().min(1).max(50) }),
  }),
  transferNumber: z
    .string()
    .trim()
    .transform((v) => v || null)
    .refine((v) => v === null || isE164(v), "Transfer number must be in E.164 format, e.g. +14155550100"),
  tools: z.object({
    endCall: z.boolean(),
    transferCall: z.boolean(),
    booking: z.boolean(),
    custom: z.array(CustomFunctionSchema.omit({ authorizationEnc: true }).extend(SecretInput)).max(15),
    mcp: z.array(McpServerSchema.omit({ authorizationEnc: true }).extend(SecretInput)).max(5),
  }),
  booking: BookingSchema,
  guardrails: GuardrailsSchema,
  postCall: PostCallSchema,
});

function issueMessage(e: z.ZodError): string {
  const issue = e.issues[0];
  const where = issue.path.filter((p) => typeof p === "string").join(" › ");
  return where && !issue.message.includes(" ") ? `${where}: ${issue.message}` : issue.message;
}

export async function saveAgent(_: AgentFormState, form: FormData): Promise<AgentFormState> {
  const { tenantId } = await requireSession();
  let raw: unknown;
  try {
    raw = JSON.parse(form.get("payload")?.toString() ?? "");
  } catch {
    return { error: "The form couldn't be read. Reload the page and try again." };
  }
  const parsed = Payload.safeParse(raw);
  if (!parsed.success) return { error: issueMessage(parsed.error) };
  const a = parsed.data;
  const id = form.get("id")?.toString();

  if (!isValidTimezone(a.booking.timezone)) return { error: `"${a.booking.timezone}" isn't a time zone` };
  if (a.tools.transferCall && !a.transferNumber) return { error: "Add a transfer number, or turn off call transfer" };
  const names = a.tools.custom.map((f) => f.name);
  if (new Set(names).size !== names.length) return { error: "Two custom functions have the same name" };
  if (a.booking.integrationId) {
    const [own] = await sql`SELECT 1 FROM integrations WHERE id = ${a.booking.integrationId} AND tenant_id = ${tenantId}`;
    if (!own) return { error: "Pick one of your connected calendars" };
  }
  if (a.tools.booking && !a.booking.integrationId) return { error: "Choose a calendar for booking, or turn booking off" };
  if (a.postCall.webhookUrl) {
    try {
      await assertPublicHttpsUrl(a.postCall.webhookUrl);
    } catch (e) {
      return { error: `Webhook URL: ${(e as Error).message}` };
    }
  }
  if (a.knowledgeBaseIds.length) {
    const owned = await sql`SELECT id FROM knowledge_bases WHERE tenant_id = ${tenantId} AND id = ANY(${a.knowledgeBaseIds})`;
    if (owned.length !== new Set(a.knowledgeBaseIds).size) return { error: "Pick knowledge bases from this workspace" };
  }
  const fieldNames = a.postCall.analysisFields.map((f) => f.name);
  if (new Set(fieldNames).size !== fieldNames.length) return { error: "Two analysis fields have the same name" };
  const tts = a.providers.tts;
  if (a.providers.mode === "pipeline" && tts.provider === "elevenlabs" && tts.voice && !(await elevenLabsVoiceExists(tts.voice))) {
    return { error: `ElevenLabs has no voice "${tts.voice}" in your account. Pick one from the Voice list, or add it in ElevenLabs › Voice Library › Add to My Voices.` };
  }

  // Keep stored secrets the user didn't change.
  const previous = isUuid(id)
    ? parseTools((await sql`SELECT tools FROM agents WHERE id = ${id} AND tenant_id = ${tenantId}`)[0]?.tools)
    : parseTools({});
  const secret = (input: { authorization?: string; keepAuthorization: boolean }, old?: string) =>
    input.authorization ? encrypt(input.authorization) : input.keepAuthorization ? old : undefined;
  const tools = {
    endCall: a.tools.endCall,
    transferCall: a.tools.transferCall,
    booking: a.tools.booking,
    custom: a.tools.custom.map(({ authorization, keepAuthorization, ...f }) => ({
      ...f,
      authorizationEnc: secret({ authorization, keepAuthorization }, previous.custom.find((p) => p.name === f.name)?.authorizationEnc),
    })),
    mcp: a.tools.mcp.map(({ authorization, keepAuthorization, ...m }) => ({
      ...m,
      authorizationEnc: secret({ authorization, keepAuthorization }, previous.mcp.find((p) => p.url === m.url)?.authorizationEnc),
    })),
  };

  const providers = a.providers;
  const values = {
    name: a.name,
    greeting: a.greeting,
    system_prompt: a.systemPrompt,
    announce_ai: a.announceAi,
    language: a.language,
    transfer_number: a.transferNumber,
    // Legacy columns, still read by older agent workers.
    voice_id: providers.tts.voice ?? "",
    llm_model: providers.llm.model,
    providers: sql.json(providers),
    // Round-trip through JSON: drops undefined secrets and satisfies the driver's JSON type.
    tools: sql.json(JSON.parse(JSON.stringify(tools))),
    booking: sql.json(a.booking),
    guardrails: sql.json(a.guardrails),
    post_call: sql.json(a.postCall),
    type: a.type,
    knowledge_base_ids: [...new Set(a.knowledgeBaseIds)],
  };

  if (isUuid(id)) {
    await sql`
      UPDATE agents SET ${sql(values)}, updated_at = now()
      WHERE id = ${id} AND tenant_id = ${tenantId}`;
    revalidatePath(`/agents/${id}`);
    return { saved: true };
  }
  const [created] = await sql`INSERT INTO agents ${sql({ ...values, tenant_id: tenantId })} RETURNING id`;
  redirect(`/agents/${created.id}`);
}

export async function deleteAgent(form: FormData) {
  const { tenantId } = await requireSession();
  const id = form.get("id")?.toString();
  const [row] = isUuid(id) ? await sql<{ type: string }[]>`DELETE FROM agents WHERE id = ${id} AND tenant_id = ${tenantId} RETURNING type` : [];
  redirect(row?.type === "chat" ? "/chatbots" : "/agents");
}

export async function duplicate(form: FormData) {
  const { tenantId } = await requireSession();
  const id = form.get("id")?.toString();
  const copy = isUuid(id) ? await duplicateAgent(tenantId, id) : null;
  if (copy) redirect(`/agents/${copy}`);
}

export async function importAgentFile(text: string): Promise<{ error?: string } | undefined> {
  const { tenantId } = await requireSession();
  if (text.length > 500_000) return { error: "That file is too large to be an agent export." };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { error: "That file isn't valid JSON." };
  }
  let id: string;
  try {
    id = await importAgent(tenantId, json);
  } catch (e) {
    return { error: (e as Error).message };
  }
  redirect(`/agents/${id}`);
}

export type TestWebhookResult = { ok: boolean; message: string };

/** Sends a sample call_ended payload to a webhook URL, so clients can map fields in n8n, Zapier, etc. */
export async function sendTestWebhook(agentId: string | undefined, url: string): Promise<TestWebhookResult> {
  const { tenantId } = await requireSession();
  if (!url.trim()) return { ok: false, message: "Enter a webhook URL first." };
  const [agent] = isUuid(agentId) ? await sql<{ name: string }[]>`SELECT name FROM agents WHERE id = ${agentId} AND tenant_id = ${tenantId}` : [];
  const body = { event: "call_ended", test: true, call: sampleCall(agentId ?? "00000000-0000-0000-0000-000000000000", agent?.name ?? "Test agent") };
  const result = await postWebhook(url.trim(), webhookSecret(tenantId), "call_ended", body, crypto.randomUUID());
  return result.error ? { ok: false, message: result.error } : { ok: true, message: `Delivered (HTTP ${result.status}).` };
}

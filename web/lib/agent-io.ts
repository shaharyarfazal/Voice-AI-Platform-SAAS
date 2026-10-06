import "server-only";
import { z } from "zod";
import { BookingSchema, GuardrailsSchema, parseBooking, parseGuardrails, parsePostCall, parseTools, PostCallSchema, ToolsSchema } from "./agent-settings";
import { findProvider, LANGUAGES, resolveProviders } from "./catalog";
import { encrypt } from "./crypto";
import { sql } from "./db";

// Agents as portable JSON: export, import (into any workspace) and duplicate. Secrets (function
// credentials) and workspace-specific links (calendar, knowledge bases) are never exported.

export const AGENT_EXPORT_VERSION = 1;

/** A copy of `o` without the given keys. */
function without<T extends Record<string, unknown>>(o: T, ...keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
}

type Row = {
  name: string; type: string; greeting: string; system_prompt: string; language: string; announce_ai: boolean;
  transfer_number: string | null; providers: unknown; tools: unknown; guardrails: unknown; booking: unknown; post_call: unknown;
  llm_model: string; voice_id: string;
};

export function exportAgent(row: Row) {
  const tools = parseTools(row.tools);
  return {
    kind: "agent",
    version: AGENT_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    agent: {
      name: row.name,
      type: row.type,
      greeting: row.greeting,
      systemPrompt: row.system_prompt,
      language: row.language,
      announceAi: row.announce_ai,
      transferNumber: row.transfer_number,
      providers: resolveProviders(row.providers as never, row),
      tools: {
        ...tools,
        custom: tools.custom.map(({ authorizationEnc, ...f }) => ({ ...f, needsAuthorization: Boolean(authorizationEnc) })),
        mcp: tools.mcp.map(({ authorizationEnc, ...m }) => ({ ...m, needsAuthorization: Boolean(authorizationEnc) })),
      },
      guardrails: parseGuardrails(row.guardrails),
      booking: { ...parseBooking(row.booking), integrationId: null },
      postCall: parsePostCall(row.post_call),
    },
  };
}

const Choice = z.object({ provider: z.string(), model: z.string().max(100), voice: z.string().max(200).optional() });

export const ImportSchema = z.object({
  kind: z.literal("agent").optional(),
  agent: z.object({
    name: z.string().trim().min(1).max(100),
    type: z.enum(["inbound", "outbound", "chat"]).default("inbound"),
    greeting: z.string().trim().min(1).max(500),
    systemPrompt: z.string().trim().min(1).max(20000),
    language: z.string().refine((l) => LANGUAGES.some((x) => x.code === l), "Unknown language").default("en-US"),
    announceAi: z.boolean().default(true),
    transferNumber: z.string().nullish(),
    providers: z
      .object({
        mode: z.enum(["pipeline", "realtime"]).default("pipeline"),
        stt: Choice.refine((c) => findProvider("stt", c.provider), "Unknown speech recognition provider"),
        llm: Choice.refine((c) => findProvider("llm", c.provider), "Unknown LLM provider"),
        tts: Choice.refine((c) => findProvider("tts", c.provider), "Unknown voice provider"),
        realtime: z.object({ model: z.string().max(100), voice: z.string().max(50) }).optional(),
      })
      .partial()
      .optional(),
    tools: z
      .object({
        endCall: z.boolean().optional(),
        transferCall: z.boolean().optional(),
        booking: z.boolean().optional(),
        custom: z.array(z.record(z.string(), z.unknown())).max(15).optional(),
        mcp: z.array(z.record(z.string(), z.unknown())).max(5).optional(),
      })
      .optional(),
    guardrails: z.record(z.string(), z.unknown()).optional(),
    booking: z.record(z.string(), z.unknown()).optional(),
    postCall: z.record(z.string(), z.unknown()).optional(),
  }),
});

/** Creates an agent from exported JSON. Throws a readable error if the file isn't a valid export. */
export async function importAgent(tenantId: string, json: unknown, nameOverride?: string): Promise<string> {
  const parsed = ImportSchema.safeParse(json);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    throw new Error(`Not a valid agent file: ${i.path.join(".") || "file"}: ${i.message}`);
  }
  const a = parsed.data.agent;
  const defaults = resolveProviders(null, { llm_model: "gpt-4.1-mini", voice_id: "" });
  const providers = { ...defaults, ...(a.providers ?? {}), realtime: a.providers?.realtime ?? defaults.realtime };
  const tools = ToolsSchema.parse({
    ...a.tools,
    custom: (a.tools?.custom ?? []).map((f) => without(f, "needsAuthorization", "authorizationEnc", "authorization")),
    mcp: (a.tools?.mcp ?? []).map((m) => without(m, "needsAuthorization", "authorizationEnc", "authorization")),
  });
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO agents ${sql({
      tenant_id: tenantId,
      name: (nameOverride ?? a.name).slice(0, 100),
      type: a.type,
      greeting: a.greeting,
      system_prompt: a.systemPrompt,
      language: a.language,
      announce_ai: a.announceAi,
      transfer_number: a.transferNumber ?? null,
      voice_id: providers.tts.voice ?? "",
      llm_model: providers.llm.model,
      providers: sql.json(providers as never),
      tools: sql.json(JSON.parse(JSON.stringify(tools))),
      guardrails: sql.json(GuardrailsSchema.parse(a.guardrails ?? {})),
      booking: sql.json({ ...BookingSchema.parse(a.booking ?? {}), integrationId: null }),
      post_call: sql.json(PostCallSchema.parse(a.postCall ?? {})),
    })}
    RETURNING id`;
  return row.id;
}

export async function duplicateAgent(tenantId: string, agentId: string): Promise<string | null> {
  const [row] = await sql<(Row & { knowledge_base_ids: string[]; tools: unknown; booking: unknown })[]>`
    SELECT * FROM agents WHERE id = ${agentId} AND tenant_id = ${tenantId}`;
  if (!row) return null;
  // A copy within the workspace keeps credentials, calendar and knowledge links.
  const [copy] = await sql<{ id: string }[]>`
    INSERT INTO agents (tenant_id, name, type, greeting, system_prompt, language, announce_ai, transfer_number, voice_id, llm_model,
                        providers, tools, guardrails, booking, post_call, knowledge_base_ids)
    SELECT tenant_id, left(name || ' (copy)', 100), type, greeting, system_prompt, language, announce_ai, transfer_number, voice_id, llm_model,
           providers, tools, guardrails, booking, post_call, knowledge_base_ids
    FROM agents WHERE id = ${agentId} AND tenant_id = ${tenantId}
    RETURNING id`;
  return copy.id;
}

type FullRow = Row & { id: string; tenant_id: string; knowledge_base_ids: string[]; created_at: Date; updated_at: Date };

/** An agent as the public API returns it. */
export function apiAgent(row: FullRow) {
  return {
    id: row.id,
    ...exportAgent(row).agent,
    knowledgeBaseIds: row.knowledge_base_ids,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Applies a partial update from the API. Fields left out keep their value; custom functions and MCP
 * servers keep their stored credentials unless a new `authorization` is sent.
 */
export async function patchAgent(tenantId: string, id: string, patch: Record<string, unknown>): Promise<FullRow | null> {
  const [row] = await sql<FullRow[]>`SELECT * FROM agents WHERE id = ${id} AND tenant_id = ${tenantId}`;
  if (!row) return null;
  const current = exportAgent(row).agent;
  const merged = { ...current, ...patch, providers: { ...current.providers, ...((patch.providers as object) ?? {}) } };
  const parsed = ImportSchema.safeParse({ agent: merged });
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    throw new Error(`${i.path.slice(1).join(".") || "body"}: ${i.message}`);
  }
  const a = parsed.data.agent;
  const stored = parseTools(row.tools);
  const secretFor = (list: { name?: string; url?: string; authorizationEnc?: string }[], item: Record<string, unknown>, key: "name" | "url") => {
    if (typeof item.authorization === "string" && item.authorization) return encrypt(item.authorization);
    return list.find((x) => x[key] === item[key])?.authorizationEnc;
  };
  const tools = ToolsSchema.parse({
    ...a.tools,
    custom: (a.tools?.custom ?? []).map((f) => ({ ...without(f, "needsAuthorization", "authorization", "authorizationEnc"), authorizationEnc: secretFor(stored.custom, f, "name") })),
    mcp: (a.tools?.mcp ?? []).map((m) => ({ ...without(m, "needsAuthorization", "authorization", "authorizationEnc"), authorizationEnc: secretFor(stored.mcp, m, "url") })),
  });
  let kbIds = row.knowledge_base_ids;
  if (Array.isArray(patch.knowledgeBaseIds)) {
    const ids = [...new Set(patch.knowledgeBaseIds.map(String))];
    const owned = ids.length ? await sql<{ id: string }[]>`SELECT id FROM knowledge_bases WHERE tenant_id = ${tenantId} AND id::text = ANY(${ids})` : [];
    if (owned.length !== ids.length) throw new Error("knowledgeBaseIds: unknown knowledge base");
    kbIds = owned.map((o) => o.id);
  }
  const booking = BookingSchema.parse({ ...(a.booking ?? {}), integrationId: parseBooking(row.booking).integrationId });
  const providers = { ...a.providers };
  const [updated] = await sql<FullRow[]>`
    UPDATE agents SET ${sql({
      name: a.name,
      type: a.type,
      greeting: a.greeting,
      system_prompt: a.systemPrompt,
      language: a.language,
      announce_ai: a.announceAi,
      transfer_number: a.transferNumber ?? null,
      providers: sql.json(providers as never),
      llm_model: (providers.llm as { model?: string } | undefined)?.model ?? row.llm_model,
      tools: sql.json(JSON.parse(JSON.stringify(tools))),
      guardrails: sql.json(GuardrailsSchema.parse(a.guardrails ?? {})),
      booking: sql.json(booking),
      post_call: sql.json(PostCallSchema.parse(a.postCall ?? {})),
      knowledge_base_ids: kbIds,
    })}, updated_at = now()
    WHERE id = ${id} AND tenant_id = ${tenantId} RETURNING *`;
  return updated;
}

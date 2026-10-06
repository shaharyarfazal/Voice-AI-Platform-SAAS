import "server-only";
import { z } from "zod";
import { apiAgent, exportAgent, importAgent, patchAgent, duplicateAgent } from "../agent-io";
import { type ApiCaller } from "../api-keys";
import { loadChatAgent, sendChatMessage, startChat } from "../chat/sessions";
import { sql } from "../db";
import { addSource, fileToText } from "../knowledge/ingest";
import { searchKnowledge } from "../knowledge/search";
import { createTestCallToken } from "../livekit";
import { assertPublicUrl } from "../net";
import { startOutboundCall } from "../outbound";
import { isUuid } from "../validation";
import { loadWebhookCall } from "../webhooks";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export type Ctx = { caller: ApiCaller; request: Request; params: Record<string, string>; url: URL };
type Handler = (ctx: Ctx) => Promise<unknown>;

const notFound = (what: string) => new ApiError(404, "not_found", `${what} not found`);
const invalid = (message: string) => new ApiError(400, "invalid_request", message);

async function body<T = Record<string, unknown>>(ctx: Ctx): Promise<T> {
  try {
    return (await ctx.request.json()) as T;
  } catch {
    throw invalid("The request body must be JSON.");
  }
}

function id(ctx: Ctx, name = "id"): string {
  const v = ctx.params[name];
  if (!isUuid(v)) throw notFound("Resource");
  return v;
}

async function agentRow(ctx: Ctx) {
  const [row] = await sql`SELECT * FROM agents WHERE id = ${id(ctx)} AND tenant_id = ${ctx.caller.tenantId}`;
  if (!row) throw notFound("Agent");
  return row;
}

async function kbOwned(ctx: Ctx): Promise<string> {
  const kbId = id(ctx);
  const [kb] = await sql`SELECT 1 FROM knowledge_bases WHERE id = ${kbId} AND tenant_id = ${ctx.caller.tenantId}`;
  if (!kb) throw notFound("Knowledge base");
  return kbId;
}

export const HANDLERS: Record<string, Handler> = {
  // ---- Agents ----
  "list-agents": async (ctx) => {
    const type = ctx.url.searchParams.get("type");
    const rows = await sql`
      SELECT * FROM agents WHERE tenant_id = ${ctx.caller.tenantId} ${type ? sql`AND type = ${type}` : sql``} ORDER BY created_at`;
    return { data: rows.map((r) => apiAgent(r as never)) };
  },
  "create-agent": async (ctx) => {
    const b = await body(ctx);
    let newId: string;
    try {
      newId = await importAgent(ctx.caller.tenantId, "agent" in b ? b : { agent: b });
    } catch (e) {
      throw invalid((e as Error).message.replace(/^Not a valid agent file: /, ""));
    }
    const [row] = await sql`SELECT * FROM agents WHERE id = ${newId}`;
    return apiAgent(row as never);
  },
  "get-agent": async (ctx) => apiAgent((await agentRow(ctx)) as never),
  "update-agent": async (ctx) => {
    try {
      const row = await patchAgent(ctx.caller.tenantId, id(ctx), await body(ctx));
      if (!row) throw notFound("Agent");
      return apiAgent(row);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw invalid((e as Error).message);
    }
  },
  "delete-agent": async (ctx) => {
    const rows = await sql`DELETE FROM agents WHERE id = ${id(ctx)} AND tenant_id = ${ctx.caller.tenantId} RETURNING id`;
    if (!rows.length) throw notFound("Agent");
    return { deleted: true };
  },
  "duplicate-agent": async (ctx) => {
    const copy = await duplicateAgent(ctx.caller.tenantId, id(ctx));
    if (!copy) throw notFound("Agent");
    const [row] = await sql`SELECT * FROM agents WHERE id = ${copy}`;
    return apiAgent(row as never);
  },
  "export-agent": async (ctx) => exportAgent((await agentRow(ctx)) as never),

  // ---- Calls ----
  "list-calls": async (ctx) => {
    const q = ctx.url.searchParams;
    const limit = Math.min(100, Math.max(1, Number(q.get("limit")) || 50));
    const before = q.get("before");
    const agent = q.get("agent_id");
    const direction = q.get("direction");
    if (before && Number.isNaN(Date.parse(before))) throw invalid("before must be an ISO date-time");
    const ids = await sql<{ id: string; started_at: Date }[]>`
      SELECT id, started_at FROM calls WHERE tenant_id = ${ctx.caller.tenantId}
        ${before ? sql`AND started_at < ${before}` : sql``}
        ${isUuid(agent) ? sql`AND agent_id = ${agent}` : sql``}
        ${direction ? sql`AND direction = ${direction}` : sql``}
      ORDER BY started_at DESC LIMIT ${limit}`;
    const data = [];
    for (const r of ids) {
      const c = await loadWebhookCall(r.id);
      if (c) data.push({ ...c.call, transcript: undefined, transcript_object: undefined });
    }
    return { data, next_before: ids.length === limit ? ids[ids.length - 1].started_at.toISOString() : null };
  },
  "get-call": async (ctx) => {
    const c = await loadWebhookCall(id(ctx));
    if (!c || c.tenantId !== ctx.caller.tenantId) throw notFound("Call");
    return c.call;
  },
  "create-call": async (ctx) => {
    const b = z
      .object({ agent_id: z.uuid(), to_number: z.string().min(5).max(20), from_number: z.string().max(20).nullish(), variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional() })
      .safeParse(await body(ctx));
    if (!b.success) throw invalid(`${b.error.issues[0].path.join(".")}: ${b.error.issues[0].message}`);
    const r = await startOutboundCall({
      tenantId: ctx.caller.tenantId,
      agentId: b.data.agent_id,
      to: b.data.to_number,
      from: b.data.from_number,
      variables: Object.fromEntries(Object.entries(b.data.variables ?? {}).map(([k, v]) => [k, String(v)])),
    });
    if ("error" in r) throw new ApiError(r.status, r.status === 404 ? "not_found" : "call_failed", r.error);
    return { call_id: r.callId, status: "dialing", from_number: r.from, to_number: r.to };
  },
  "create-web-call": async (ctx) => {
    const b = await body<{ agent_id?: string }>(ctx);
    if (!isUuid(b.agent_id)) throw invalid("agent_id is required");
    const [agent] = await sql`SELECT 1 FROM agents WHERE id = ${b.agent_id} AND tenant_id = ${ctx.caller.tenantId}`;
    if (!agent) throw notFound("Agent");
    const t = await createTestCallToken(b.agent_id, `api-${ctx.caller.keyId.slice(0, 8)}`);
    return { room_name: t.roomName, url: t.url, token: t.token, expires_in: 900 };
  },

  // ---- Chats ----
  "create-chat": async (ctx) => {
    const b = await body<{ agent_id?: string; metadata?: unknown }>(ctx);
    if (!isUuid(b.agent_id)) throw invalid("agent_id is required");
    const agent = await loadChatAgent(b.agent_id, ctx.caller.tenantId);
    if (!agent) throw notFound("Agent");
    const metadata = b.metadata && typeof b.metadata === "object" ? JSON.parse(JSON.stringify(b.metadata).slice(0, 4000) || "{}") : {};
    const s = await startChat(agent, { channel: "api", visitor: { metadata } });
    return { chat_id: s.id, greeting: s.greeting };
  },
  "send-chat-message": async (ctx) => {
    const b = await body<{ text?: unknown }>(ctx);
    if (typeof b.text !== "string") throw invalid("text is required");
    const r = await sendChatMessage(id(ctx), ctx.caller.tenantId, b.text);
    if ("error" in r) throw new ApiError(r.status, r.status === 404 ? "not_found" : "invalid_request", r.error);
    return r;
  },
  "get-chat": async (ctx) => {
    const [c] = await sql`
      SELECT id, agent_id, channel, started_at, messages FROM chat_sessions WHERE id = ${id(ctx)} AND tenant_id = ${ctx.caller.tenantId}`;
    if (!c) throw notFound("Chat");
    return { chat_id: c.id, agent_id: c.agent_id, channel: c.channel, started_at: c.started_at, messages: c.messages };
  },

  // ---- Knowledge ----
  "list-kbs": async (ctx) => ({
    data: await sql`
      SELECT k.id, k.name,
        (SELECT count(*)::int FROM kb_sources s WHERE s.kb_id = k.id) AS sources,
        (SELECT coalesce(sum(chunks), 0)::int FROM kb_sources s WHERE s.kb_id = k.id) AS passages
      FROM knowledge_bases k WHERE k.tenant_id = ${ctx.caller.tenantId} ORDER BY k.created_at`,
  }),
  "create-kb": async (ctx) => {
    const b = await body<{ name?: unknown }>(ctx);
    if (typeof b.name !== "string" || !b.name.trim()) throw invalid("name is required");
    const [kb] = await sql`INSERT INTO knowledge_bases (tenant_id, name) VALUES (${ctx.caller.tenantId}, ${b.name.trim().slice(0, 120)}) RETURNING id, name`;
    return kb;
  },
  "get-kb": async (ctx) => {
    const kbId = await kbOwned(ctx);
    const [kb] = await sql`SELECT id, name FROM knowledge_bases WHERE id = ${kbId}`;
    const sources = await sql`
      SELECT id, kind AS type, title, url, status, pages, chunks AS passages, error, updated_at FROM kb_sources WHERE kb_id = ${kbId} ORDER BY created_at`;
    return { ...kb, sources };
  },
  "delete-kb": async (ctx) => {
    const kbId = await kbOwned(ctx);
    await sql`DELETE FROM knowledge_bases WHERE id = ${kbId}`;
    await sql`UPDATE agents SET knowledge_base_ids = array_remove(knowledge_base_ids, ${kbId}::uuid) WHERE tenant_id = ${ctx.caller.tenantId}`;
    return { deleted: true };
  },
  "add-source": async (ctx) => {
    const kbId = await kbOwned(ctx);
    if ((ctx.request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const form = await ctx.request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw invalid("Send the document in a `file` field.");
      let text: string;
      try {
        text = await fileToText(file.name, new Uint8Array(await file.arrayBuffer()));
      } catch (e) {
        throw invalid((e as Error).message);
      }
      return { id: await addSource(ctx.caller.tenantId, kbId, { kind: "file", title: file.name, content: text }), status: "queued" };
    }
    const b = await body<{ type?: string; url?: string; max_pages?: number; title?: string; text?: string }>(ctx);
    if (b.type === "text") {
      if (typeof b.text !== "string" || b.text.trim().length < 20) throw invalid("text must be at least 20 characters");
      return { id: await addSource(ctx.caller.tenantId, kbId, { kind: "text", title: (b.title ?? "Text").slice(0, 300), content: b.text }), status: "queued" };
    }
    if (b.type !== "website" && b.type !== "url") throw invalid("type must be website, url or text");
    try {
      await assertPublicUrl(String(b.url ?? ""), { allowHttp: true });
    } catch (e) {
      throw invalid(`url: ${(e as Error).message}`);
    }
    const url = new URL(String(b.url));
    const maxPages = Math.min(200, Math.max(1, Number(b.max_pages) || 30));
    const sourceId = await addSource(ctx.caller.tenantId, kbId, { kind: b.type, title: url.hostname + (b.type === "url" ? url.pathname : ""), url: url.toString(), maxPages });
    return { id: sourceId, status: "queued" };
  },
  "delete-source": async (ctx) => {
    const kbId = await kbOwned(ctx);
    const rows = await sql`DELETE FROM kb_sources WHERE id = ${id(ctx, "source_id")} AND kb_id = ${kbId} RETURNING id`;
    if (!rows.length) throw notFound("Source");
    return { deleted: true };
  },
  "search-kb": async (ctx) => {
    const kbId = await kbOwned(ctx);
    const b = await body<{ query?: unknown; limit?: unknown }>(ctx);
    if (typeof b.query !== "string" || !b.query.trim()) throw invalid("query is required");
    return { data: await searchKnowledge(ctx.caller.tenantId, [kbId], b.query, Math.min(10, Math.max(1, Number(b.limit) || 5))) };
  },

  // ---- Other ----
  "list-numbers": async (ctx) => ({
    data: await sql`SELECT e164 AS number, carrier, agent_id FROM phone_numbers WHERE tenant_id = ${ctx.caller.tenantId} ORDER BY created_at`,
  }),
  "list-widgets": async (ctx) => ({
    data: await sql`
      SELECT id, name, agent_id, mode, public_key, allowed_origins, enabled FROM widgets WHERE tenant_id = ${ctx.caller.tenantId} ORDER BY created_at`,
  }),
};

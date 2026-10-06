import "server-only";
import type { FullAgentRow } from "../agent-runtime-config";
import { sql } from "../db";
import { runChat, type ChatMessage } from "./engine";

export const MAX_MESSAGE_CHARS = 2000;
export const MAX_USER_MESSAGES = 60;

export type ChatAgent = FullAgentRow & { tenant_id: string; tenant_status: string };

export async function loadChatAgent(agentId: string, tenantId?: string): Promise<ChatAgent | null> {
  const [agent] = await sql<ChatAgent[]>`
    SELECT a.*, t.name AS tenant_name, t.status AS tenant_status FROM agents a JOIN tenants t ON t.id = a.tenant_id
    WHERE a.id = ${agentId} ${tenantId ? sql`AND a.tenant_id = ${tenantId}` : sql``}`;
  return agent ?? null;
}

export async function startChat(
  agent: ChatAgent,
  opts: { channel: "widget" | "api" | "dashboard"; widgetId?: string | null; visitor?: Record<string, unknown> },
): Promise<{ id: string; greeting: string }> {
  const greeting = agent.greeting?.trim() || "Hi! How can I help you today?";
  const messages: ChatMessage[] = [{ role: "assistant", content: greeting, at: new Date().toISOString() }];
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO chat_sessions (tenant_id, agent_id, widget_id, channel, visitor, messages)
    VALUES (${agent.tenant_id}, ${agent.id}, ${opts.widgetId ?? null}, ${opts.channel}, ${sql.json((opts.visitor ?? {}) as never)}, ${sql.json(messages as never)})
    RETURNING id`;
  return { id: row.id, greeting };
}

export type SendResult = { reply: string } | { error: string; status: number };

export async function sendChatMessage(sessionId: string, tenantId: string, text: string): Promise<SendResult> {
  const content = text.trim();
  if (!content) return { error: "Message is empty", status: 400 };
  if (content.length > MAX_MESSAGE_CHARS) return { error: `Messages can be up to ${MAX_MESSAGE_CHARS} characters`, status: 400 };
  const [session] = await sql<{ agent_id: string | null; messages: ChatMessage[]; visitor: Record<string, unknown>; user_count: number }[]>`
    SELECT agent_id, messages, visitor, (SELECT count(*)::int FROM jsonb_array_elements(messages) m WHERE m->>'role' = 'user') AS user_count
    FROM chat_sessions WHERE id = ${sessionId} AND tenant_id = ${tenantId}`;
  if (!session?.agent_id) return { error: "Conversation not found", status: 404 };
  if (session.user_count >= MAX_USER_MESSAGES) return { error: "This conversation is too long. Start a new one.", status: 429 };
  const agent = await loadChatAgent(session.agent_id);
  if (!agent || agent.tenant_status !== "active") return { error: "This assistant isn't available", status: 404 };

  const userMessage: ChatMessage = { role: "user", content, at: new Date().toISOString() };
  const result = await runChat(agent, [...session.messages, userMessage], { sessionId, visitor: session.visitor });
  const reply: ChatMessage = { role: "assistant", content: result.reply, at: new Date().toISOString() };
  await sql`
    UPDATE chat_sessions SET
      messages = messages || ${sql.json([userMessage, reply] as never)},
      message_count = message_count + 2,
      input_tokens = input_tokens + ${result.inputTokens},
      output_tokens = output_tokens + ${result.outputTokens},
      last_message_at = now()
    WHERE id = ${sessionId}`;
  return { reply: result.reply };
}

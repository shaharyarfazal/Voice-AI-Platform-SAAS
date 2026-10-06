"use server";

import { requireSession } from "@/lib/auth";
import { loadChatAgent, sendChatMessage, startChat } from "@/lib/chat/sessions";
import { isUuid } from "@/lib/validation";

export async function startTestChat(agentId: string): Promise<{ id: string; greeting: string } | { error: string }> {
  const { tenantId, userId } = await requireSession();
  if (!isUuid(agentId)) return { error: "Agent not found" };
  const agent = await loadChatAgent(agentId, tenantId);
  if (!agent) return { error: "Agent not found" };
  return startChat(agent, { channel: "dashboard", visitor: { userId } });
}

export async function sendTestChat(sessionId: string, text: string): Promise<{ reply?: string; error?: string }> {
  const { tenantId } = await requireSession();
  if (!isUuid(sessionId)) return { error: "Conversation not found" };
  const result = await sendChatMessage(sessionId, tenantId, text);
  return "reply" in result ? { reply: result.reply } : { error: result.error };
}

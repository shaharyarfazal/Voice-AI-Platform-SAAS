"use server";

import { requireSession } from "@/lib/auth";
import { startOutboundCall } from "@/lib/outbound";
import { isUuid } from "@/lib/validation";

export type DialState = { error?: string; callId?: string; to?: string } | undefined;

export async function dial(agentId: string, _: DialState, form: FormData): Promise<DialState> {
  const { tenantId } = await requireSession();
  if (!isUuid(agentId)) return { error: "Agent not found" };
  const variables: Record<string, string> = {};
  for (const line of (form.get("variables")?.toString() ?? "").split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) variables[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const result = await startOutboundCall({
    tenantId,
    agentId,
    to: form.get("to")?.toString() ?? "",
    from: form.get("from")?.toString() || null,
    variables,
  });
  return "error" in result ? { error: result.error } : { callId: result.callId, to: result.to };
}

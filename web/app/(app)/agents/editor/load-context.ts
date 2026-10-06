import "server-only";
import { sql } from "@/lib/db";
import { loadProviderCatalog } from "@/lib/provider-catalog";
import { getWorkerCapabilities } from "@/lib/settings";
import { webhookSecret } from "@/lib/webhooks";
import type { EditorContext } from "./types";

export async function loadEditorContext(tenantId: string): Promise<EditorContext> {
  const [integrations, caps, catalog, knowledgeBases] = await Promise.all([
    sql<EditorContext["integrations"]>`
      SELECT id, provider, account_email FROM integrations WHERE tenant_id = ${tenantId} ORDER BY created_at`,
    getWorkerCapabilities(),
    loadProviderCatalog(),
    sql<EditorContext["knowledgeBases"]>`
      SELECT k.id, k.name, (SELECT coalesce(sum(chunks), 0)::int FROM kb_sources s WHERE s.kb_id = k.id) AS chunks
      FROM knowledge_bases k WHERE k.tenant_id = ${tenantId} ORDER BY k.created_at`,
  ]);
  return {
    integrations: [...integrations],
    available: { stt: caps.stt, llm: caps.llm, tts: caps.tts },
    timezones: Intl.supportedValuesOf("timeZone"),
    catalog,
    knowledgeBases: [...knowledgeBases],
    webhookSecret: webhookSecret(tenantId),
  };
}

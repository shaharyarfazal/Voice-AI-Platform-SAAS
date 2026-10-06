import "server-only";
import { sql } from "@/lib/db";
import { listElevenLabsVoices } from "@/lib/elevenlabs";
import { getWorkerCapabilities } from "@/lib/settings";
import { webhookSecret } from "@/lib/webhooks";
import type { EditorContext } from "./types";

export async function loadEditorContext(tenantId: string): Promise<EditorContext> {
  const [integrations, caps, elevenlabsVoices] = await Promise.all([
    sql<EditorContext["integrations"]>`
      SELECT id, provider, account_email FROM integrations WHERE tenant_id = ${tenantId} ORDER BY created_at`,
    getWorkerCapabilities(),
    listElevenLabsVoices(),
  ]);
  return {
    integrations: [...integrations],
    available: { stt: caps.stt, llm: caps.llm, tts: caps.tts },
    timezones: Intl.supportedValuesOf("timeZone"),
    elevenlabsVoices,
    webhookSecret: webhookSecret(tenantId),
  };
}

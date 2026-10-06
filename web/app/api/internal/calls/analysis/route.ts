import { z } from "zod";
import { isInternalRequest } from "@/lib/auth";
import { sql } from "@/lib/db";
import { dispatchWebhook, loadWebhookCall } from "@/lib/webhooks";

const Analysis = z.object({
  callId: z.uuid(),
  analysis: z.object({
    summary: z.string().max(5000),
    user_sentiment: z.enum(["positive", "neutral", "negative", "unknown"]),
    call_successful: z.boolean().nullable(),
    custom_data: z.record(z.string(), z.unknown()),
  }),
});

// Called by the agent worker after the call ends, once the AI has summarised it. Sends call_analyzed.
export async function POST(request: Request) {
  if (!isInternalRequest(request)) return new Response("Unauthorized", { status: 401 });
  const parsed = Analysis.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
  const { callId, analysis } = parsed.data;
  const [row] = await sql<{ agent_id: string | null }[]>`
    UPDATE calls SET analysis = ${sql.json(JSON.parse(JSON.stringify(analysis)))} WHERE id = ${callId} RETURNING agent_id`;
  if (!row) return new Response("Not found", { status: 404 });
  dispatchWebhook(row.agent_id, "call_analyzed", callId, async () => (await loadWebhookCall(callId))?.call ?? null);
  return Response.json({ ok: true });
}

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isInternalRequest } from "@/lib/auth";
import { sql } from "@/lib/db";
import { dispatchWebhook } from "@/lib/webhooks";

const CallStart = z.object({
  roomName: z.string().min(1),
  agentId: z.uuid(),
  /** Picked by the agent worker so the start, end and analysis all carry the same id. */
  callId: z.uuid().optional(),
  startedAt: z.iso.datetime({ offset: true }).optional(),
  channel: z.enum(["phone", "web"]),
  fromNumber: z.string().nullish(),
  toNumber: z.string().nullish(),
});

// Called by the agent worker when it answers: shows the call as live in the admin panel and
// sends the call_started webhook.
export async function POST(request: Request) {
  if (!isInternalRequest(request)) return new Response("Unauthorized", { status: 401 });
  const parsed = CallStart.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
  const c = parsed.data;
  const callId = c.callId ?? randomUUID();
  const inserted = await sql<{ started_at: Date; agent_name: string }[]>`
    INSERT INTO live_calls (room_name, tenant_id, agent_id, channel, from_number, to_number, call_id, started_at)
    SELECT ${c.roomName}, a.tenant_id, a.id, ${c.channel}, ${c.fromNumber ?? null}, ${c.toNumber ?? null}, ${callId},
           ${c.startedAt ?? new Date().toISOString()}
    FROM agents a WHERE a.id = ${c.agentId}
    ON CONFLICT (room_name) DO NOTHING
    RETURNING started_at, (SELECT name FROM agents WHERE id = ${c.agentId}) AS agent_name`;

  const started = inserted[0];
  if (started) {
    dispatchWebhook(c.agentId, "call_started", callId, async () => ({
      call_id: callId,
      agent_id: c.agentId,
      agent_name: started.agent_name,
      direction: c.channel === "web" ? "web" : "inbound",
      from_number: c.fromNumber ?? null,
      to_number: c.toNumber ?? null,
      start_timestamp: started.started_at.toISOString(),
    }));
  }
  return Response.json({ ok: true, callId });
}

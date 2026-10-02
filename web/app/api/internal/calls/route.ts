import { z } from "zod";
import { isInternalRequest } from "@/lib/auth";
import { sql } from "@/lib/db";

const CallReport = z.object({
  roomName: z.string().min(1),
  agentId: z.uuid(),
  channel: z.enum(["phone", "web"]),
  fromNumber: z.string().nullish(),
  toNumber: z.string().nullish(),
  startedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }),
  outcome: z.string().min(1),
  transcript: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string(), at: z.string() })),
});

// Called by the agent worker when a call ends. Idempotent on room name.
export async function POST(request: Request) {
  if (!isInternalRequest(request)) return new Response("Unauthorized", { status: 401 });

  const parsed = CallReport.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
  const call = parsed.data;

  const durationSeconds = Math.max(
    0,
    Math.round((Date.parse(call.endedAt) - Date.parse(call.startedAt)) / 1000),
  );

  const inserted = await sql`
    INSERT INTO calls (tenant_id, agent_id, room_name, channel, from_number, to_number,
                       started_at, ended_at, duration_seconds, outcome, transcript)
    SELECT a.tenant_id, a.id, ${call.roomName}, ${call.channel}, ${call.fromNumber ?? null},
           ${call.toNumber ?? null}, ${call.startedAt}, ${call.endedAt}, ${durationSeconds},
           ${call.outcome}, ${sql.json(call.transcript)}
    FROM agents a WHERE a.id = ${call.agentId}
    ON CONFLICT (room_name) DO NOTHING
    RETURNING id`;

  return Response.json({ id: inserted[0]?.id ?? null });
}

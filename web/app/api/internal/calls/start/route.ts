import { z } from "zod";
import { isInternalRequest } from "@/lib/auth";
import { sql } from "@/lib/db";

const CallStart = z.object({
  roomName: z.string().min(1),
  agentId: z.uuid(),
  channel: z.enum(["phone", "web"]),
  fromNumber: z.string().nullish(),
});

// Called by the agent worker when it answers, so the admin panel can show live calls by tenant.
export async function POST(request: Request) {
  if (!isInternalRequest(request)) return new Response("Unauthorized", { status: 401 });
  const parsed = CallStart.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
  const c = parsed.data;
  await sql`
    INSERT INTO live_calls (room_name, tenant_id, agent_id, channel, from_number)
    SELECT ${c.roomName}, a.tenant_id, a.id, ${c.channel}, ${c.fromNumber ?? null} FROM agents a WHERE a.id = ${c.agentId}
    ON CONFLICT (room_name) DO NOTHING`;
  return Response.json({ ok: true });
}

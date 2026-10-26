import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";

// The call a job was booked on (bookings.call_id is the call's room name), for the job drawer:
// transcript, AI analysis and whether a recording exists (played from /api/recordings/<id>).
export async function GET(_request: Request, ctx: RouteContext<"/api/schedule-calls/[room]">) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { room } = await ctx.params;
  const [call] = await sql<{ id: string; started_at: Date; duration_seconds: number; from_number: string | null; transcript: unknown; transcript_purged_at: Date | null; has_recording: boolean; analysis: unknown }[]>`
    SELECT id, started_at, duration_seconds, from_number, transcript, transcript_purged_at, has_recording, analysis
    FROM calls WHERE tenant_id = ${session.tenantId} AND room_name = ${room}`;
  if (!call) return Response.json({ call: null });
  return Response.json({ call });
}

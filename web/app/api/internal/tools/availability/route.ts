import { z } from "zod";
import { isInternalRequest } from "@/lib/auth";
import { checkAvailability } from "@/lib/booking-service";

const Body = z.object({ agentId: z.uuid(), date: z.string() });

// Agent tool: check_availability(date)
export async function POST(request: Request) {
  if (!isInternalRequest(request)) return new Response("Unauthorized", { status: 401 });
  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) return Response.json({ ok: false, message: "Invalid request" }, { status: 400 });
  return Response.json(await checkAvailability(parsed.data.agentId, parsed.data.date.trim()));
}

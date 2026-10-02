import { z } from "zod";
import { isInternalRequest } from "@/lib/auth";
import { bookAppointment } from "@/lib/booking-service";

const Body = z.object({
  agentId: z.uuid(),
  start: z.string(),
  name: z.string().trim().min(1).max(200),
  phone: z.string().max(40).nullish(),
  email: z.email().nullish().or(z.literal("").transform(() => null)),
  notes: z.string().max(1000).optional(),
  roomName: z.string().optional(),
});

// Agent tool: book_appointment(...)
export async function POST(request: Request) {
  if (!isInternalRequest(request)) return new Response("Unauthorized", { status: 401 });
  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ ok: false, message: `Missing or invalid details: ${parsed.error.issues[0].path.join(".")}` }, { status: 400 });
  }
  return Response.json(await bookAppointment(parsed.data));
}

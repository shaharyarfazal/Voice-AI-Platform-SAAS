import { z } from "zod";
import { isInternalRequest } from "@/lib/auth";
import { saveWorkerCapabilities } from "@/lib/settings";

const Body = z.object({ providers: z.object({ stt: z.array(z.string()), llm: z.array(z.string()), tts: z.array(z.string()) }) });

// The agent worker reports which AI providers have API keys, so the editor only offers those.
export async function POST(request: Request) {
  if (!isInternalRequest(request)) return new Response("Unauthorized", { status: 401 });
  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
  await saveWorkerCapabilities(parsed.data.providers);
  return Response.json({ ok: true });
}

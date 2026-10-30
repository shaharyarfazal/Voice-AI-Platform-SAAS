import { isCronRequest } from "@/lib/cron";
import { drainQueue, requeueStale } from "@/lib/knowledge/ingest";

// Processes queued knowledge sources (website crawls, documents) on serverless hosting. Stops
// claiming new sources with a minute to spare before the function's time limit.
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequest(request)) return new Response("Unauthorized", { status: 401 });
  const requeued = await requeueStale();
  const processed = await drainQueue(Date.now() + (maxDuration - 60) * 1000);
  return Response.json({ processed, requeued });
}

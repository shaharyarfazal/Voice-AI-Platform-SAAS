import { isCronRequest } from "@/lib/cron";
import { requeueStale } from "@/lib/knowledge/ingest";
import { purgeOldTranscripts } from "@/lib/maintenance";

// Hourly housekeeping on serverless hosting, where there is no long-running process to do it:
// transcripts and recordings past each workspace's retention, and knowledge sources cut off mid-run.
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequest(request)) return new Response("Unauthorized", { status: 401 });
  const [purged, requeued] = await Promise.all([purgeOldTranscripts(), requeueStale()]);
  return Response.json({ purged, requeued });
}

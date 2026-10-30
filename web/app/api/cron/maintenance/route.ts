import { isCronRequest } from "@/lib/cron";
import { requeueStale } from "@/lib/knowledge/ingest";
import { purgeOldTranscripts } from "@/lib/maintenance";
import { renewNumbers } from "@/lib/phone-numbers";

// Hourly housekeeping on serverless hosting, where there is no long-running process to do it:
// transcripts and recordings past each workspace's retention, knowledge sources cut off mid-run, and
// the monthly charge for phone numbers bought through the platform.
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequest(request)) return new Response("Unauthorized", { status: 401 });
  const [purged, requeued, numbers] = await Promise.all([purgeOldTranscripts(), requeueStale(), renewNumbers()]);
  return Response.json({ purged, requeued, numbers });
}

import { getSession, hasRole } from "@/lib/auth";
import { drainQueue, requeueStale } from "@/lib/knowledge/ingest";

// The setup wizard calls this while it shows "Building your agents", so the workspace's website and
// documents are read inside a request that is still running, rather than only in background work
// that serverless hosting may cut off. Sources already being read elsewhere are skipped.
export const maxDuration = 300;

export async function POST() {
  const session = await getSession();
  if (!session || !hasRole(session, "admin")) return new Response("Unauthorized", { status: 401 });
  await requeueStale(session.tenantId);
  const processed = await drainQueue(Date.now() + (maxDuration - 60) * 1000, session.tenantId);
  return Response.json({ processed });
}

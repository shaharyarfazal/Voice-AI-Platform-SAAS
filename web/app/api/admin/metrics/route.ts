import { getAdminSession } from "@/lib/auth";
import { collectMetrics } from "@/lib/admin-metrics";

export async function GET() {
  if (!(await getAdminSession())) return new Response("Not found", { status: 404 });
  return Response.json(await collectMetrics(), { headers: { "cache-control": "no-store" } });
}

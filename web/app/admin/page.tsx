import { collectMetrics } from "@/lib/admin-metrics";
import { requireAdmin } from "@/lib/auth";
import { LiveDashboard } from "./live-dashboard";

export default async function AdminOverviewPage() {
  await requireAdmin();
  return <LiveDashboard initial={await collectMetrics()} />;
}

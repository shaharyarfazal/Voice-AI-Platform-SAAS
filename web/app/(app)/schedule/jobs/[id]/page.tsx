import { notFound } from "next/navigation";
import { JobDetail } from "@/components/schedule/job-drawer";
import { requireSession } from "@/lib/auth";
import { isUuid } from "@/lib/validation";
import { loadSchedule } from "../../load";

export default async function JobPage({ params }: PageProps<"/schedule/jobs/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const session = await requireSession();
  const data = await loadSchedule(session);
  if (!data.ok) return <p className="card text-sm text-muted">{data.message}</p>;
  return (
    <div className="card max-w-2xl">
      <JobDetail id={id} labels={data.settings.labels} canEdit />
    </div>
  );
}

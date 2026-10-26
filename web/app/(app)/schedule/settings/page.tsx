import { ServicesEditor, SettingsForm, type Vertical } from "@/components/schedule/settings-forms";
import { hasRole, requireSession } from "@/lib/auth";
import { schedulerJson } from "@/lib/scheduler";
import { loadSchedule } from "../load";

export default async function ScheduleSettingsPage() {
  const session = await requireSession();
  const [data, verticals] = await Promise.all([loadSchedule(session), schedulerJson<Vertical[]>(session, "/v1/verticals")]);
  if (!data.ok) return <p className="card text-sm text-muted">{data.message}</p>;
  const canEdit = hasRole(session, "admin");
  return (
    <div className="space-y-8">
      <SettingsForm initial={data.settings} verticals={verticals.ok ? verticals.data : []} canEdit={canEdit} />
      {data.settings.configured && <ServicesEditor initial={data.services} settings={data.settings} canEdit={canEdit} />}
    </div>
  );
}

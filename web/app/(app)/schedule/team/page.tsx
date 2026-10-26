import { TeamEditor } from "@/components/schedule/team-editor";
import { hasRole, requireSession } from "@/lib/auth";
import { loadSchedule } from "../load";

export default async function TeamPage({ searchParams }: PageProps<"/schedule/team">) {
  const q = await searchParams;
  const connected = typeof q.connected === "string" ? q.connected : null;
  const error = typeof q.error === "string" ? q.error : null;
  const session = await requireSession();
  const data = await loadSchedule(session);
  if (!data.ok) return <p className="card text-sm text-muted">{data.message}</p>;
  const notice = connected ? { ok: true, text: `Connected ${connected}. Busy times are syncing now.` } : error ? { ok: false, text: error } : undefined;
  return <TeamEditor initial={data.staff} settings={data.settings} canEdit={hasRole(session, "admin")} notice={notice} />;
}

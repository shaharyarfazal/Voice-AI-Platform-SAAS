import Link from "next/link";
import { ScheduleCalendar } from "@/components/schedule/calendar";
import type { Connections } from "@/components/schedule/types";
import { hasRole, requireSession } from "@/lib/auth";
import { schedulerJson } from "@/lib/scheduler";
import { loadSchedule } from "./load";

export default async function SchedulePage() {
  const session = await requireSession();
  const data = await loadSchedule(session);
  if (!data.ok) return <p className="card text-sm text-muted">{data.message}</p>;
  const admin = hasRole(session, "admin");

  if (!data.settings.configured) {
    return (
      <div className="card space-y-3">
        <h2 className="font-semibold">Set up scheduling</h2>
        <p className="text-sm text-muted">
          Choose your time zone and industry, add your services and team with their working hours, then turn on
          &ldquo;Book jobs for your team&rdquo; on a voice agent&apos;s Tools tab.
        </p>
        {admin ? (
          <Link href="/schedule/settings" className="btn">Start setup</Link>
        ) : (
          <p className="text-sm text-muted">Ask a workspace owner or admin to set it up.</p>
        )}
      </div>
    );
  }

  const connections = await schedulerJson<Connections>(session, "/v1/connections");
  const names = new Map(data.staff.map((s) => [s.id, s.name]));
  const reconnect = connections.ok ? connections.data.accounts.filter((a) => a.status !== "active") : [];
  const failed = connections.ok ? connections.data.failures.filter((f) => f.status === "dead" && f.booking_id) : [];
  const failures = failed.length;

  return (
    <>
      {(reconnect.length > 0 || failures > 0) && (
        <div className="card space-y-1 border-critical/50 text-sm" role="alert">
          {reconnect.map((a) => (
            <p key={a.id}>
              <span className="font-medium">{names.get(a.staff_id ?? "") ?? a.email}</span>&apos;s calendar ({a.email}) needs
              reconnecting. Until then they aren&apos;t booked automatically.{" "}
              <Link href="/schedule/team" className="text-accent underline">Reconnect</Link>
            </p>
          ))}
          {failures > 0 && (
            <p>
              {failures === 1 ? "1 job couldn't" : `${failures} jobs couldn't`} be written to a technician&apos;s calendar:{" "}
              {failed.slice(0, 5).map((f, i) => (
                <span key={f.id}>
                  {i > 0 && ", "}
                  <Link href={`/schedule/jobs/${f.booking_id}`} className="text-accent underline">job {i + 1}</Link>
                </span>
              ))}
              {failures > 5 && ` and ${failures - 5} more`}. Open a job to retry.
            </p>
          )}
        </div>
      )}
      <ScheduleCalendar
      timezone={data.settings.timezone}
      labels={data.settings.labels}
      services={data.services}
      canEdit
    />
    </>
  );
}

import "server-only";
import type { Session } from "@/lib/auth";
import { schedulerConfigured, schedulerJson } from "@/lib/scheduler";
import type { Service, Settings, Staff } from "@/components/schedule/types";

export type ScheduleData =
  | { ok: true; settings: Settings; services: Service[]; staff: Staff[] }
  | { ok: false; message: string };

/** What every schedule page needs, fetched in parallel from the scheduling engine. */
export async function loadSchedule(session: Session): Promise<ScheduleData> {
  if (!schedulerConfigured()) return { ok: false, message: "The scheduling service isn't set up on this server yet (SCHED_JWT_SECRET)." };
  const [settings, services, staff] = await Promise.all([
    schedulerJson<Settings>(session, "/v1/settings"),
    schedulerJson<Service[]>(session, "/v1/services"),
    schedulerJson<Staff[]>(session, "/v1/staff"),
  ]);
  if (!settings.ok) return { ok: false, message: settings.message };
  if (!services.ok) return { ok: false, message: services.message };
  if (!staff.ok) return { ok: false, message: staff.message };
  return { ok: true, settings: settings.data, services: services.data, staff: staff.data };
}

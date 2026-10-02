import "server-only";
import { parseBooking, type Booking } from "./agent-settings";
import { busyTimes, CalendarError, createEvent, type IntegrationRow } from "./calendar";
import { sql } from "./db";
import { dayWindow, formatDayLabel, freeSlots, localToday, parseLocalDateTime } from "./scheduling";

type BookingContext = { agentId: string; tenantId: string; booking: Booking; integration: IntegrationRow };

/** The agent's booking setup and calendar connection, or a message the agent can say. */
async function load(agentId: string): Promise<BookingContext | { error: string }> {
  const [agent] = await sql<{ tenant_id: string; tools: { booking?: boolean }; booking: unknown }[]>`
    SELECT tenant_id, tools, booking FROM agents WHERE id = ${agentId}`;
  if (!agent || !agent.tools?.booking) return { error: "Booking isn't enabled for this line." };
  const booking = parseBooking(agent.booking);
  if (!booking.integrationId) return { error: "No calendar is connected, so I can't book right now. I can take a message instead." };
  const [integration] = await sql<IntegrationRow[]>`
    SELECT * FROM integrations WHERE id = ${booking.integrationId} AND tenant_id = ${agent.tenant_id}`;
  if (!integration) return { error: "The calendar isn't connected, so I can't book right now. I can take a message instead." };
  return { agentId, tenantId: agent.tenant_id, booking, integration };
}

const MAX_SLOTS_SPOKEN = 8;

export async function checkAvailability(agentId: string, date: string) {
  const ctx = await load(agentId);
  if ("error" in ctx) return { ok: false, message: ctx.error };
  const { booking, integration } = ctx;
  const window = dayWindow(date, booking.timezone);
  if (!window) return { ok: false, message: `"${date}" isn't a valid date. Use the format YYYY-MM-DD.` };
  if (date < localToday(booking.timezone)) return { ok: false, message: "That date is in the past." };

  try {
    const busy = await busyTimes(integration, booking.calendarId, window);
    const slots = freeSlots(date, booking, busy);
    if (slots.length === 0) {
      return { ok: true, date, timezone: booking.timezone, slots: [], message: `There are no open times on ${formatDayLabel(date)}.` };
    }
    const spoken = slots.slice(0, MAX_SLOTS_SPOKEN);
    return {
      ok: true,
      date,
      timezone: booking.timezone,
      slots: spoken.map((s) => ({ start: s.local, label: s.label })),
      message:
        `Open times on ${formatDayLabel(date)}: ${spoken.map((s) => s.label).join(", ")}` +
        (slots.length > spoken.length ? `, and ${slots.length - spoken.length} more later in the day.` : "."),
    };
  } catch (e) {
    console.error("availability failed", e);
    return { ok: false, message: e instanceof CalendarError ? "I can't reach the calendar right now. I can take a message instead." : "Something went wrong checking the calendar." };
  }
}

export type BookRequest = {
  agentId: string;
  start: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  notes?: string;
  roomName?: string;
};

export async function bookAppointment(req: BookRequest) {
  const ctx = await load(req.agentId);
  if ("error" in ctx) return { ok: false, message: ctx.error };
  const { booking, integration } = ctx;
  const start = parseLocalDateTime(req.start, booking.timezone);
  if (!start) return { ok: false, message: `"${req.start}" isn't a valid time. Use YYYY-MM-DDTHH:MM from the open times.` };
  const date = req.start.slice(0, 10);

  try {
    // One booking at a time per calendar, so two callers can't take the same slot.
    return await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${integration.id}))`;
      const window = dayWindow(date, booking.timezone)!;
      const busy = await busyTimes(integration, booking.calendarId, window);
      // Our own bookings count too, in case the calendar hasn't caught up yet.
      const ours = await tx<{ starts_at: Date; ends_at: Date }[]>`
        SELECT starts_at, ends_at FROM appointments
        WHERE integration_id = ${integration.id} AND starts_at < ${window.end} AND ends_at > ${window.start}`;
      busy.push(...ours.map((a) => ({ start: a.starts_at, end: a.ends_at })));
      const slot = freeSlots(date, booking, busy).find((s) => s.start.getTime() === start.getTime());
      if (!slot) return { ok: false, message: "That time isn't available any more. Check availability again and offer another time." };

      const title = booking.eventTitle.replaceAll("{name}", req.name);
      const description = [
        `Booked by phone assistant.`,
        `Name: ${req.name}`,
        req.phone && `Phone: ${req.phone}`,
        req.email && `Email: ${req.email}`,
        req.notes && `Notes: ${req.notes}`,
      ]
        .filter(Boolean)
        .join("\n");
      const eventId = await createEvent(integration, booking.calendarId, {
        title,
        description,
        start: slot.start,
        end: slot.end,
        timeZone: booking.timezone,
        attendeeEmail: req.email ?? undefined,
        attendeeName: req.name,
      });
      await tx`
        INSERT INTO appointments (tenant_id, agent_id, integration_id, room_name, starts_at, ends_at, timezone,
                                  customer_name, customer_phone, customer_email, notes, external_event_id)
        VALUES (${ctx.tenantId}, ${req.agentId}, ${integration.id}, ${req.roomName ?? null}, ${slot.start}, ${slot.end},
                ${booking.timezone}, ${req.name}, ${req.phone ?? null}, ${req.email ?? null}, ${req.notes ?? ""}, ${eventId})`;
      return {
        ok: true,
        message:
          `Booked for ${formatDayLabel(date)} at ${slot.label}.` +
          (req.email ? " A calendar invitation is on its way to their email." : ""),
      };
    });
  } catch (e) {
    console.error("booking failed", e);
    return { ok: false, message: e instanceof CalendarError ? "I couldn't reach the calendar to book. I can take a message instead." : "Something went wrong while booking." };
  }
}

// Pure time-zone and slot maths for booking. No I/O, so it can be unit-tested.
import type { Booking, Day } from "./agent-settings";

const DAY_KEYS: Day[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

type Parts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(date: Date, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday),
  };
}

/** The instant when the wall clock in `timeZone` shows the given local time. */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  // Two passes settle the offset, including across daylight-saving changes.
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess), timeZone);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += asUtc - shown;
  }
  return new Date(guess);
}

export type Interval = { start: Date; end: Date };
export type Slot = { start: Date; end: Date; local: string; label: string };

const pad = (n: number) => String(n).padStart(2, "0");

function parseDate(date: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const [y, m, d] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  return check.getUTCMonth() === m - 1 && check.getUTCDate() === d ? { y, m, d } : null;
}

export function formatSlotLabel(start: Date, timeZone: string): string {
  return start.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
}

export function formatDayLabel(date: string): string {
  const p = parseDate(date);
  if (!p) return date;
  return new Date(Date.UTC(p.y, p.m - 1, p.d, 12)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** The query window covering a local date, for fetching busy times. */
export function dayWindow(date: string, timeZone: string): Interval | null {
  const p = parseDate(date);
  if (!p) return null;
  const start = zonedTimeToUtc(p.y, p.m, p.d, 0, 0, timeZone);
  const next = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
  const end = zonedTimeToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, timeZone);
  return { start, end };
}

/** Free slots on a local date: opening hours, minus busy times (with buffer), notice and horizon. */
export function freeSlots(date: string, booking: Booking, busy: Interval[], now: Date = new Date()): Slot[] {
  const p = parseDate(date);
  if (!p) return [];
  const tz = booking.timezone;
  const weekday = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  const windows = booking.hours[DAY_KEYS[weekday]] ?? [];
  const earliest = now.getTime() + booking.minNoticeHours * 3600_000;
  const latest = now.getTime() + booking.maxDaysAhead * 86400_000;
  const slotMs = booking.slotMinutes * 60_000;
  const bufferMs = booking.bufferMinutes * 60_000;

  const slots: Slot[] = [];
  for (const w of windows) {
    const [sh, sm] = w.start.split(":").map(Number);
    const [eh, em] = w.end.split(":").map(Number);
    const winStart = zonedTimeToUtc(p.y, p.m, p.d, sh, sm, tz).getTime();
    const winEnd = zonedTimeToUtc(p.y, p.m, p.d, eh, em, tz).getTime();
    for (let t = winStart; t + slotMs <= winEnd; t += slotMs) {
      if (t < earliest || t > latest) continue;
      const clash = busy.some((b) => t < b.end.getTime() + bufferMs && t + slotMs > b.start.getTime() - bufferMs);
      if (clash) continue;
      const start = new Date(t);
      const lp = zonedParts(start, tz);
      slots.push({
        start,
        end: new Date(t + slotMs),
        local: `${lp.year}-${pad(lp.month)}-${pad(lp.day)}T${pad(lp.hour)}:${pad(lp.minute)}`,
        label: formatSlotLabel(start, tz),
      });
    }
  }
  return slots;
}

/** "2026-10-05T14:30" in the booking time zone → instant, or null if malformed. */
export function parseLocalDateTime(value: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [y, m, d, h, mi] = match.slice(1).map(Number);
  if (!parseDate(`${match[1]}-${match[2]}-${match[3]}`) || h > 23 || mi > 59) return null;
  return zonedTimeToUtc(y, m, d, h, mi, timeZone);
}

/** Today's local date (YYYY-MM-DD) in a time zone. */
export function localToday(timeZone: string, now: Date = new Date()): string {
  const p = zonedParts(now, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

// Wall-clock arithmetic in the business's time zone, with Intl only (no date library). A "day" is a
// YYYY-MM-DD string in that zone; instants are Date objects.

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

export type Zoned = { y: number; m: number; d: number; h: number; min: number; day: string; minutes: number };

/** The wall-clock reading of `date` in `tz`. */
export function zoned(date: Date, tz: string): Zoned {
  const p = Object.fromEntries(partsFormatter(tz).formatToParts(date).map((x) => [x.type, x.value]));
  const y = Number(p.year), m = Number(p.month), d = Number(p.day), h = Number(p.hour) % 24, min = Number(p.minute);
  return { y, m, d, h, min, day: `${p.year}-${p.month}-${p.day}`, minutes: h * 60 + min };
}

function offsetMs(date: Date, tz: string): number {
  const z = zoned(date, tz);
  const asUtc = Date.UTC(z.y, z.m - 1, z.d, z.h, z.min, date.getUTCSeconds());
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant when the clock in `tz` reads `day` + `minutes` (minutes may exceed 1440). */
export function atLocal(day: string, minutes: number, tz: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  let result = guess - offsetMs(new Date(guess), tz);
  // Second pass settles days when DST changes between the guess and the answer.
  result = guess - offsetMs(new Date(result), tz);
  return new Date(result);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday, like the engine. */
export function weekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function startOfWeek(day: string): string {
  return addDays(day, -weekday(day));
}

export function today(tz: string): string {
  return zoned(new Date(), tz).day;
}

export function formatTime(date: Date, tz: string): string {
  return date.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
}

export function formatDay(day: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
}

export function formatDateTime(date: Date, tz: string): string {
  return date.toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { BookingSchema } from "../lib/agent-settings.ts";
import { dayWindow, freeSlots, parseLocalDateTime, zonedTimeToUtc } from "../lib/scheduling.ts";

const booking = BookingSchema.parse({ timezone: "America/New_York", minNoticeHours: 0 });
const longAgo = new Date("2026-10-01T00:00:00Z"); // within the 60-day booking horizon

test("local time to UTC, including daylight saving", () => {
  assert.equal(zonedTimeToUtc(2026, 7, 1, 9, 0, "America/New_York").toISOString(), "2026-07-01T13:00:00.000Z"); // EDT
  assert.equal(zonedTimeToUtc(2026, 12, 1, 9, 0, "America/New_York").toISOString(), "2026-12-01T14:00:00.000Z"); // EST
  assert.equal(zonedTimeToUtc(2026, 3, 29, 9, 0, "Europe/London").toISOString(), "2026-03-29T08:00:00.000Z"); // BST starts
  assert.equal(zonedTimeToUtc(2026, 10, 5, 9, 30, "Asia/Kolkata").toISOString(), "2026-10-05T04:00:00.000Z");
});

test("weekday opening hours produce 30-minute slots", () => {
  const slots = freeSlots("2026-10-05", booking, [], longAgo); // Monday
  assert.equal(slots.length, 16); // 09:00..16:30
  assert.equal(slots[0].local, "2026-10-05T09:00");
  assert.equal(slots[0].label, "9:00 AM");
  assert.equal(slots.at(-1)!.local, "2026-10-05T16:30");
});

test("closed on weekends", () => {
  assert.equal(freeSlots("2026-10-04", booking, [], longAgo).length, 0); // Sunday
});

test("busy times and buffer remove overlapping slots", () => {
  const busy = [{ start: new Date("2026-10-05T14:00:00Z"), end: new Date("2026-10-05T15:00:00Z") }]; // 10-11 EDT
  const slots = freeSlots("2026-10-05", booking, busy, longAgo).map((s) => s.local.slice(11));
  assert.ok(!slots.includes("10:00") && !slots.includes("10:30"));
  assert.ok(slots.includes("09:30") && slots.includes("11:00"));
  const buffered = freeSlots("2026-10-05", { ...booking, bufferMinutes: 15 }, busy, longAgo).map((s) => s.local.slice(11));
  assert.ok(!buffered.includes("09:30") && !buffered.includes("11:00"));
});

test("minimum notice hides slots too soon", () => {
  const now = new Date("2026-10-05T13:10:00Z"); // 09:10 EDT
  const slots = freeSlots("2026-10-05", { ...booking, minNoticeHours: 2 }, [], now);
  assert.equal(slots[0].local, "2026-10-05T11:30");
});

test("parsing and validation", () => {
  assert.equal(parseLocalDateTime("2026-10-05T10:30", "America/New_York")?.toISOString(), "2026-10-05T14:30:00.000Z");
  assert.equal(parseLocalDateTime("2026-02-30T10:30", "America/New_York"), null);
  assert.equal(parseLocalDateTime("tomorrow at 3", "America/New_York"), null);
  const w = dayWindow("2026-10-05", "America/New_York")!;
  assert.equal(w.start.toISOString(), "2026-10-05T04:00:00.000Z");
  assert.equal(w.end.toISOString(), "2026-10-06T04:00:00.000Z");
});

test("nothing beyond the booking horizon", () => {
  assert.equal(freeSlots("2026-10-05", booking, [], new Date("2026-01-01T00:00:00Z")).length, 0);
});

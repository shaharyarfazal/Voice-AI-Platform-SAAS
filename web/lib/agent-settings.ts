import { z } from "zod";

// Shapes of the JSON columns on agents (tools, guardrails, booking). Parsed with defaults, so
// agents saved before a field existed still work.

const BUILTIN_NAMES = ["end_call", "transfer_call", "check_availability", "book_appointment"];

export const CustomFunctionSchema = z.object({
  name: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,39}$/, "Function names use lowercase letters, numbers and underscores, like get_order_status")
    .refine((n) => !BUILTIN_NAMES.includes(n), "That name is used by a built-in tool"),
  description: z.string().trim().min(10, "Describe when the agent should use the function (at least 10 characters)").max(1000),
  url: z.url().refine((u) => u.startsWith("https://"), "Function URLs must use https://"),
  /** JSON Schema for the arguments (an object schema). */
  parameters: z.record(z.string(), z.unknown()),
  /** Encrypted Authorization header value, if any. */
  authorizationEnc: z.string().optional(),
  /** Spoken while the function runs, e.g. "Let me check that for you." */
  speakBefore: z.string().max(200).default(""),
});
export type CustomFunction = z.infer<typeof CustomFunctionSchema>;

export const McpServerSchema = z.object({
  name: z.string().trim().min(1).max(60),
  url: z.url().refine((u) => u.startsWith("https://"), "MCP server URLs must use https://"),
  authorizationEnc: z.string().optional(),
  /** Empty = all tools the server offers. */
  allowedTools: z.array(z.string()).default([]),
});
export type McpServer = z.infer<typeof McpServerSchema>;

export const ToolsSchema = z.object({
  endCall: z.boolean().default(true),
  transferCall: z.boolean().default(true),
  booking: z.boolean().default(false),
  custom: z.array(CustomFunctionSchema).max(15).default([]),
  mcp: z.array(McpServerSchema).max(5).default([]),
});
export type AgentTools = z.infer<typeof ToolsSchema>;

export const GuardrailsSchema = z.object({
  /** What the agent may help with. Anything else is politely declined. */
  allowedTopics: z.string().max(2000).default(""),
  /** Things the agent must never discuss or do. */
  forbidden: z.string().max(2000).default(""),
  maxCallMinutes: z.number().int().min(1).max(120).default(15),
  /** Hang up after this many seconds of silence (after one "are you still there?"). */
  silenceTimeoutSeconds: z.number().int().min(5).max(120).default(20),
  /** Words or phrases the agent must never say (checked before speaking). */
  blockedPhrases: z.array(z.string()).max(50).default([]),
});
export type Guardrails = z.infer<typeof GuardrailsSchema>;

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Day = (typeof DAYS)[number];

export const BookingSchema = z.object({
  integrationId: z.string().nullable().default(null),
  calendarId: z.string().default("primary"),
  timezone: z.string().default("UTC"),
  /** Opening hours per weekday; an empty list means closed. */
  hours: z
    .record(z.enum(DAYS), z.array(z.object({ start: Time, end: Time })))
    .default({
      mon: [{ start: "09:00", end: "17:00" }],
      tue: [{ start: "09:00", end: "17:00" }],
      wed: [{ start: "09:00", end: "17:00" }],
      thu: [{ start: "09:00", end: "17:00" }],
      fri: [{ start: "09:00", end: "17:00" }],
      sat: [],
      sun: [],
    }),
  slotMinutes: z.number().int().min(5).max(480).default(30),
  bufferMinutes: z.number().int().min(0).max(120).default(0),
  minNoticeHours: z.number().min(0).max(720).default(2),
  maxDaysAhead: z.number().int().min(1).max(365).default(60),
  eventTitle: z.string().max(200).default("Appointment: {name}"),
});
export type Booking = z.infer<typeof BookingSchema>;

export function parseTools(v: unknown): AgentTools {
  return ToolsSchema.parse(v ?? {});
}
export function parseGuardrails(v: unknown): Guardrails {
  return GuardrailsSchema.parse(v ?? {});
}
export function parseBooking(v: unknown): Booking {
  return BookingSchema.parse(v ?? {});
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

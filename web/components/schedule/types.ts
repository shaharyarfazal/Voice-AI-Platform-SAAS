// Shapes returned by the scheduling engine's dashboard API (scheduler/app/api/dashboard).

export type Labels = { staff: string; staff_plural: string; booking: string; booking_plural: string; customer: string };

export type Settings = {
  configured: boolean;
  vertical: string;
  timezone: string;
  slot_granularity_min: number;
  min_notice_min: number;
  emergency_min_notice_min: number;
  max_days_ahead: number;
  hold_ttl_sec: number;
  default_daily_job_cap: number | null;
  assignment_mode: "least_busy" | "round_robin" | "weighted" | "priority";
  unavailable_on_reauth: boolean;
  service_area: { postal_codes?: string[] };
  labels: Labels;
  label_overrides: Record<string, string>;
  skills: string[];
};

export type Staff = {
  id: string;
  name: string;
  first_name: string;
  phone: string | null;
  email: string | null;
  timezone: string | null;
  skills: string[];
  zones: string[];
  active: boolean;
  rr_weight: number;
  priority: number;
  daily_job_cap: number | null;
  color: string | null;
  working_hours?: { weekday: number; start: string; end: string }[];
};

export type Service = {
  id: string;
  name: string;
  duration_min: number;
  buffer_before_min: number;
  buffer_after_min: number;
  required_skills: string[];
  active: boolean;
};

export type CalendarEvent = {
  id: string;
  kind: "booking" | "time_off" | "busy";
  staff_id: string;
  start: string;
  end: string;
  title: string;
  status?: "held" | "confirmed" | "completed" | "canceled";
  urgency?: "emergency" | "standard";
  customer_name?: string | null;
  customer_phone?: string | null;
  service_name?: string;
  address?: string | null;
  rescheduled?: boolean;
  external_change?: boolean;
  version?: number;
};

export type CalendarData = { timezone: string; slot_granularity_min: number; staff: Staff[]; events: CalendarEvent[] };

export type BookingDetail = {
  id: string;
  status: string;
  version: number;
  start: string;
  end: string;
  timezone: string;
  confirmation_code: string | null;
  urgency: string;
  source: string;
  description: string;
  notes: string;
  details: Record<string, unknown>;
  service_address: Record<string, string | null> | null;
  call_id: string | null;
  assignment_reason: Record<string, unknown> | null;
  external_change: ExternalChange | null;
  cancel_reason: string | null;
  created_at: string;
  staff: Staff | null;
  service: Service | null;
  customer: { id: string; name: string; phone: string; email: string | null } | null;
  history: { kind: string; from_status: string | null; to_status: string | null; actor_type: string; actor_id: string | null; data: Record<string, unknown>; at: string }[];
  call_artifacts: { recording_url: string | null; transcript: string | null; summary: Record<string, unknown> | null } | null;
  sync: { provider: string; account: string; calendar: string; event_id: string; last_pushed_at: string }[];
  sync_failures: { id: string; status: string; attempts: number; last_error: string; updated_at: string }[];
};

export type ExternalChange = {
  kind: "moved" | "deleted";
  provider: string;
  at: string;
  from?: string;
  to?: string;
  applied?: boolean;
  reason?: string;
  note?: string;
};

export type ApiError = { ok: false; code: string; message: string };

export type ConnectedCalendar = {
  id: string;
  name: string;
  is_primary: boolean;
  writable: boolean;
  use_for_busy: boolean;
  write_bookings_here: boolean;
  last_synced_at: string | null;
  notifications: boolean;
  last_error: string | null;
};

export type Connection = {
  id: string;
  staff_id: string | null;
  provider: string;
  email: string;
  status: "active" | "needs_reauth" | "revoked";
  last_error: string | null;
  last_sync_at: string | null;
  calendars: ConnectedCalendar[];
};

export type SyncFailure = { id: string; booking_id: string | null; operation: string; attempts: number; last_error: string; status: string; updated_at: string };

export type Connections = { providers: string[]; accounts: Connection[]; failures: SyncFailure[] };

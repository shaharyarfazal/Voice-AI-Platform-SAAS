"""Core scheduling tables: settings, staff, hours, services, customers, bookings, history, audit.

Revision ID: 0001_core
Revises:
Create Date: 2026-10-15
"""

from alembic import op

revision = "0001_core"
down_revision = None
branch_labels = None
depends_on = None

# Tables with a business_id column get the tenant-isolation policy.
TENANT_TABLES = [
    "business_settings",
    "staff",
    "working_hours",
    "time_off",
    "services",
    "customers",
    "customer_addresses",
    "bookings",
    "booking_events",
    "call_artifacts",
    "idempotency_keys",
    "round_robin_state",
    "audit_log",
]

UPGRADE = [
    "CREATE EXTENSION IF NOT EXISTS btree_gist",
    "CREATE EXTENSION IF NOT EXISTS pgcrypto",
    "CREATE SCHEMA IF NOT EXISTS sched",
    # The API connects and switches to sched_app (row-level security applies); background jobs that
    # span tenants switch to sched_worker (bypasses it). NOLOGIN: only reachable through SET ROLE.
    """DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sched_app') THEN CREATE ROLE sched_app NOLOGIN; END IF;
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sched_worker') THEN CREATE ROLE sched_worker NOLOGIN BYPASSRLS; END IF;
       END $$""",
    """CREATE TABLE sched.business_settings (
         business_id               uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
         vertical                  text NOT NULL DEFAULT 'generic',
         timezone                  text NOT NULL DEFAULT 'UTC',
         slot_granularity_min      integer NOT NULL DEFAULT 30 CHECK (slot_granularity_min BETWEEN 5 AND 240),
         min_notice_min            integer NOT NULL DEFAULT 120 CHECK (min_notice_min >= 0),
         emergency_min_notice_min  integer NOT NULL DEFAULT 30 CHECK (emergency_min_notice_min >= 0),
         max_days_ahead            integer NOT NULL DEFAULT 30 CHECK (max_days_ahead BETWEEN 1 AND 365),
         hold_ttl_sec              integer NOT NULL DEFAULT 180 CHECK (hold_ttl_sec BETWEEN 30 AND 1800),
         default_daily_job_cap     integer CHECK (default_daily_job_cap > 0),
         assignment_mode           text NOT NULL DEFAULT 'least_busy'
                                     CHECK (assignment_mode IN ('least_busy', 'round_robin', 'weighted', 'priority')),
         unavailable_on_reauth     boolean NOT NULL DEFAULT true,
         service_area              jsonb NOT NULL DEFAULT '{}',
         labels                    jsonb NOT NULL DEFAULT '{}',
         created_at                timestamptz NOT NULL DEFAULT now(),
         updated_at                timestamptz NOT NULL DEFAULT now()
       )""",
    """CREATE TABLE sched.staff (
         id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         business_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
         name           text NOT NULL,
         phone_e164     text,
         email          text,
         timezone       text,
         skills         text[] NOT NULL DEFAULT '{}',
         zones          text[] NOT NULL DEFAULT '{}',
         active         boolean NOT NULL DEFAULT true,
         rr_weight      integer NOT NULL DEFAULT 1 CHECK (rr_weight > 0),
         priority       integer NOT NULL DEFAULT 0,
         daily_job_cap  integer CHECK (daily_job_cap > 0),
         color          text,
         created_at     timestamptz NOT NULL DEFAULT now(),
         updated_at     timestamptz NOT NULL DEFAULT now()
       )""",
    "CREATE INDEX staff_business_active_idx ON sched.staff (business_id, active)",
    "CREATE INDEX staff_skills_idx ON sched.staff USING gin (skills)",
    """CREATE TABLE sched.working_hours (
         id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         business_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
         staff_id     uuid NOT NULL REFERENCES sched.staff(id) ON DELETE CASCADE,
         weekday      smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
         start_min    smallint NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
         end_min      smallint NOT NULL CHECK (end_min BETWEEN 1 AND 1440),
         CHECK (start_min < end_min)
       )""",
    "CREATE INDEX working_hours_staff_idx ON sched.working_hours (staff_id)",
    "CREATE INDEX working_hours_business_idx ON sched.working_hours (business_id)",
    """CREATE TABLE sched.time_off (
         id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         business_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
         staff_id     uuid NOT NULL REFERENCES sched.staff(id) ON DELETE CASCADE,
         period       tstzrange NOT NULL CHECK (NOT isempty(period)),
         reason       text NOT NULL DEFAULT '',
         created_at   timestamptz NOT NULL DEFAULT now()
       )""",
    "CREATE INDEX time_off_staff_period_idx ON sched.time_off USING gist (staff_id, period)",
    "CREATE INDEX time_off_business_idx ON sched.time_off (business_id)",
    """CREATE TABLE sched.services (
         id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         business_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
         name               text NOT NULL,
         duration_min       integer NOT NULL CHECK (duration_min BETWEEN 5 AND 1440),
         buffer_before_min  integer NOT NULL DEFAULT 0 CHECK (buffer_before_min BETWEEN 0 AND 480),
         buffer_after_min   integer NOT NULL DEFAULT 0 CHECK (buffer_after_min BETWEEN 0 AND 480),
         required_skills    text[] NOT NULL DEFAULT '{}',
         active             boolean NOT NULL DEFAULT true,
         details            jsonb NOT NULL DEFAULT '{}',
         created_at         timestamptz NOT NULL DEFAULT now(),
         updated_at         timestamptz NOT NULL DEFAULT now()
       )""",
    "CREATE UNIQUE INDEX services_business_name_key ON sched.services (business_id, lower(name))",
    """CREATE TABLE sched.customers (
         id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         business_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
         name         text NOT NULL,
         phone_e164   text NOT NULL,
         email        text,
         created_at   timestamptz NOT NULL DEFAULT now(),
         updated_at   timestamptz NOT NULL DEFAULT now(),
         UNIQUE (business_id, phone_e164)
       )""",
    """CREATE TABLE sched.customer_addresses (
         id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         business_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
         customer_id  uuid NOT NULL REFERENCES sched.customers(id) ON DELETE CASCADE,
         line1        text NOT NULL,
         line2        text,
         city         text,
         region       text,
         postal_code  text,
         country      text,
         lat          double precision,
         lng          double precision,
         notes        text,
         created_at   timestamptz NOT NULL DEFAULT now()
       )""",
    "CREATE INDEX customer_addresses_customer_idx ON sched.customer_addresses (customer_id)",
    """CREATE TABLE sched.bookings (
         id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         business_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
         staff_id           uuid NOT NULL REFERENCES sched.staff(id),
         customer_id        uuid REFERENCES sched.customers(id),
         service_id         uuid NOT NULL REFERENCES sched.services(id),
         time_range         tstzrange NOT NULL CHECK (NOT isempty(time_range)),
         blocked_range      tstzrange NOT NULL CHECK (blocked_range @> time_range),
         status             text NOT NULL
                              CHECK (status IN ('held', 'confirmed', 'completed', 'canceled', 'expired', 'released')),
         hold_expires_at    timestamptz,
         service_address    jsonb,
         address_id         uuid REFERENCES sched.customer_addresses(id) ON DELETE SET NULL,
         description        text NOT NULL DEFAULT '',
         urgency            text NOT NULL DEFAULT 'standard' CHECK (urgency IN ('emergency', 'standard')),
         source             text NOT NULL CHECK (source IN ('voice_agent', 'dashboard', 'external', 'api')),
         call_id            text,
         confirmation_code  text,
         notes              text NOT NULL DEFAULT '',
         details            jsonb NOT NULL DEFAULT '{}',
         assignment_reason  jsonb,
         external_change    jsonb,
         cancel_reason      text,
         version            integer NOT NULL DEFAULT 1,
         created_at         timestamptz NOT NULL DEFAULT now(),
         updated_at         timestamptz NOT NULL DEFAULT now(),
         CHECK (status <> 'held' OR hold_expires_at IS NOT NULL),
         CHECK (status NOT IN ('confirmed', 'completed') OR customer_id IS NOT NULL),
         -- The guarantee behind race-safe booking: one person can never have two overlapping
         -- held/confirmed jobs (buffers included), however many requests race for the slot.
         CONSTRAINT bookings_no_overlap EXCLUDE USING gist (staff_id WITH =, blocked_range WITH &&)
           WHERE (status IN ('held', 'confirmed'))
       )""",
    "CREATE INDEX bookings_business_time_idx ON sched.bookings USING gist (business_id, time_range)",
    "CREATE INDEX bookings_business_customer_idx ON sched.bookings (business_id, customer_id)",
    "CREATE INDEX bookings_hold_expiry_idx ON sched.bookings (hold_expires_at) WHERE status = 'held'",
    "CREATE INDEX bookings_call_idx ON sched.bookings (business_id, call_id) WHERE call_id IS NOT NULL",
    "CREATE UNIQUE INDEX bookings_confirmation_code_key ON sched.bookings (business_id, confirmation_code)",
    """CREATE TABLE sched.booking_events (
         id           bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
         business_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
         booking_id   uuid NOT NULL REFERENCES sched.bookings(id) ON DELETE CASCADE,
         kind         text NOT NULL,
         from_status  text,
         to_status    text,
         actor_type   text NOT NULL,
         actor_id     text,
         data         jsonb NOT NULL DEFAULT '{}',
         at           timestamptz NOT NULL DEFAULT now()
       )""",
    "CREATE INDEX booking_events_booking_idx ON sched.booking_events (booking_id, at)",
    "CREATE INDEX booking_events_business_idx ON sched.booking_events (business_id)",
    """CREATE TABLE sched.call_artifacts (
         id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         business_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
         call_id              text NOT NULL,
         recording_key        text,
         recording_url        text,
         transcript           text,
         transcript_segments  jsonb,
         summary              jsonb,
         created_at           timestamptz NOT NULL DEFAULT now(),
         updated_at           timestamptz NOT NULL DEFAULT now(),
         UNIQUE (business_id, call_id)
       )""",
    """CREATE TABLE sched.idempotency_keys (
         business_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
         key           text NOT NULL CHECK (length(key) BETWEEN 1 AND 200),
         operation     text NOT NULL,
         request_hash  text NOT NULL,
         response      jsonb,
         booking_id    uuid,
         created_at    timestamptz NOT NULL DEFAULT now(),
         PRIMARY KEY (business_id, key)
       )""",
    "CREATE INDEX idempotency_keys_created_idx ON sched.idempotency_keys (created_at)",
    """CREATE TABLE sched.round_robin_state (
         business_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
         pool_key       text NOT NULL,
         last_staff_id  uuid,
         counts         jsonb NOT NULL DEFAULT '{}',
         updated_at     timestamptz NOT NULL DEFAULT now(),
         PRIMARY KEY (business_id, pool_key)
       )""",
    """CREATE TABLE sched.audit_log (
         id           bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
         business_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
         actor_type   text NOT NULL,
         actor_id     text,
         action       text NOT NULL,
         entity_type  text NOT NULL,
         entity_id    text,
         data         jsonb NOT NULL DEFAULT '{}',
         at           timestamptz NOT NULL DEFAULT now()
       )""",
    "CREATE INDEX audit_log_business_at_idx ON sched.audit_log (business_id, at DESC)",
    # Privileges. The service only ever reads the web app's tenant, agent and API key tables.
    "GRANT USAGE ON SCHEMA sched TO sched_app, sched_worker",
    "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA sched TO sched_app, sched_worker",
    "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA sched TO sched_app, sched_worker",
    "GRANT SELECT ON sched.alembic_version TO sched_app, sched_worker",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA sched GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sched_app, sched_worker",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA sched GRANT USAGE, SELECT ON SEQUENCES TO sched_app, sched_worker",
    "GRANT USAGE ON SCHEMA public TO sched_app, sched_worker",
    "GRANT SELECT (id, name, status) ON public.tenants TO sched_app, sched_worker",
    "GRANT SELECT (id, tenant_id) ON public.agents TO sched_app, sched_worker",
    "GRANT SELECT (id, tenant_id, key_hash, revoked_at, expires_at) ON public.api_keys TO sched_app, sched_worker",
]

for _table in TENANT_TABLES:
    UPGRADE += [
        f"ALTER TABLE sched.{_table} ENABLE ROW LEVEL SECURITY",
        # Unset app.business_id matches nothing (NULL), so a forgotten scope fails closed.
        f"""CREATE POLICY tenant_isolation ON sched.{_table}
              USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid)
              WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid)""",
    ]


def upgrade() -> None:
    for statement in UPGRADE:
        op.execute(statement)


def downgrade() -> None:
    for table in reversed(TENANT_TABLES):
        op.execute(f"DROP TABLE IF EXISTS sched.{table} CASCADE")
    op.execute("REVOKE ALL ON public.tenants, public.agents, public.api_keys FROM sched_app, sched_worker")

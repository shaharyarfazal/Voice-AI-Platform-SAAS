"""Calendar sync: connected accounts, their calendars, links between our jobs and external events,
cached busy time, sync cursors/webhook channels, and the dead-letter queue.

Revision ID: 0002_calendar_sync
Revises: 0001_core
Create Date: 2026-10-15
"""

from alembic import op

revision = "0002_calendar_sync"
down_revision = "0001_core"
branch_labels = None
depends_on = None

TENANT_TABLES = [
    "connected_accounts",
    "external_calendars",
    "external_event_links",
    "external_busy_blocks",
    "sync_state",
    "sync_failures",
]

UPGRADE = [
    """CREATE TABLE sched.connected_accounts (
         id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         business_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
         staff_id             uuid REFERENCES sched.staff(id) ON DELETE CASCADE,
         provider             text NOT NULL,
         kind                 text NOT NULL DEFAULT 'calendar' CHECK (kind IN ('calendar', 'crm')),
         external_account_id  text,
         external_email       text NOT NULL,
         access_token_enc     text NOT NULL,
         refresh_token_enc    text,
         token_expires_at     timestamptz NOT NULL,
         scopes               text[] NOT NULL DEFAULT '{}',
         status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'needs_reauth', 'revoked')),
         last_error           text,
         last_sync_at         timestamptz,
         created_at           timestamptz NOT NULL DEFAULT now(),
         updated_at           timestamptz NOT NULL DEFAULT now(),
         CHECK (kind <> 'calendar' OR staff_id IS NOT NULL)
       )""",
    "CREATE UNIQUE INDEX connected_accounts_staff_key ON sched.connected_accounts (staff_id, provider, lower(external_email))",
    "CREATE INDEX connected_accounts_business_idx ON sched.connected_accounts (business_id)",
    """CREATE TABLE sched.external_calendars (
         id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         business_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
         connected_account_id   uuid NOT NULL REFERENCES sched.connected_accounts(id) ON DELETE CASCADE,
         staff_id               uuid NOT NULL REFERENCES sched.staff(id) ON DELETE CASCADE,
         external_calendar_id   text NOT NULL,
         name                   text NOT NULL DEFAULT '',
         timezone               text,
         is_primary             boolean NOT NULL DEFAULT false,
         writable               boolean NOT NULL DEFAULT true,
         use_for_busy           boolean NOT NULL DEFAULT false,
         write_bookings_here    boolean NOT NULL DEFAULT false,
         created_at             timestamptz NOT NULL DEFAULT now(),
         updated_at             timestamptz NOT NULL DEFAULT now(),
         UNIQUE (connected_account_id, external_calendar_id),
         CHECK (NOT write_bookings_here OR writable)
       )""",
    # Each person's jobs go to exactly one calendar.
    "CREATE UNIQUE INDEX external_calendars_one_write_per_staff ON sched.external_calendars (staff_id) WHERE write_bookings_here",
    "CREATE INDEX external_calendars_business_idx ON sched.external_calendars (business_id)",
    """CREATE TABLE sched.external_event_links (
         id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         business_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
         booking_id             uuid NOT NULL REFERENCES sched.bookings(id) ON DELETE CASCADE,
         external_calendar_id   uuid NOT NULL REFERENCES sched.external_calendars(id) ON DELETE CASCADE,
         external_event_id      text NOT NULL,
         etag                   text,
         -- The times we last wrote, so a sync can tell our own writes from changes made in the calendar.
         pushed_start           timestamptz,
         pushed_end             timestamptz,
         last_pushed_at         timestamptz NOT NULL DEFAULT now(),
         UNIQUE (booking_id, external_calendar_id)
       )""",
    "CREATE INDEX external_event_links_event_idx ON sched.external_event_links (external_calendar_id, external_event_id)",
    "CREATE INDEX external_event_links_business_idx ON sched.external_event_links (business_id)",
    """CREATE TABLE sched.external_busy_blocks (
         id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         business_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
         staff_id               uuid NOT NULL REFERENCES sched.staff(id) ON DELETE CASCADE,
         external_calendar_id   uuid NOT NULL REFERENCES sched.external_calendars(id) ON DELETE CASCADE,
         external_event_id      text NOT NULL,
         period                 tstzrange NOT NULL CHECK (NOT isempty(period)),
         is_ours                boolean NOT NULL DEFAULT false,
         booking_id             uuid,
         updated_at             timestamptz NOT NULL DEFAULT now(),
         UNIQUE (external_calendar_id, external_event_id)
       )""",
    "CREATE INDEX external_busy_blocks_staff_period_idx ON sched.external_busy_blocks USING gist (staff_id, period)",
    "CREATE INDEX external_busy_blocks_business_idx ON sched.external_busy_blocks (business_id)",
    """CREATE TABLE sched.sync_state (
         external_calendar_id   uuid PRIMARY KEY REFERENCES sched.external_calendars(id) ON DELETE CASCADE,
         business_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
         cursor                 text,
         channel_id             text UNIQUE,
         resource_id            text,
         channel_token_hash     text,
         channel_expires_at     timestamptz,
         last_full_sync_at      timestamptz,
         last_incremental_at    timestamptz,
         last_error             text,
         error_count            integer NOT NULL DEFAULT 0
       )""",
    "CREATE INDEX sync_state_business_idx ON sched.sync_state (business_id)",
    "CREATE INDEX sync_state_channel_expiry_idx ON sched.sync_state (channel_expires_at)",
    """CREATE TABLE sched.sync_failures (
         id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         business_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
         booking_id             uuid REFERENCES sched.bookings(id) ON DELETE CASCADE,
         connected_account_id   uuid REFERENCES sched.connected_accounts(id) ON DELETE SET NULL,
         operation              text NOT NULL,
         payload                jsonb NOT NULL DEFAULT '{}',
         attempts               integer NOT NULL DEFAULT 1,
         last_error             text NOT NULL,
         status                 text NOT NULL DEFAULT 'dead' CHECK (status IN ('dead', 'retrying', 'resolved')),
         created_at             timestamptz NOT NULL DEFAULT now(),
         updated_at             timestamptz NOT NULL DEFAULT now(),
         resolved_at            timestamptz
       )""",
    "CREATE INDEX sync_failures_open_idx ON sched.sync_failures (business_id, status) WHERE status <> 'resolved'",
    "CREATE INDEX sync_failures_booking_idx ON sched.sync_failures (booking_id)",
    "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA sched TO sched_app, sched_worker",
]

for _table in TENANT_TABLES:
    UPGRADE += [
        f"ALTER TABLE sched.{_table} ENABLE ROW LEVEL SECURITY",
        f"""CREATE POLICY tenant_isolation ON sched.{_table}
              USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid)
              WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid)""",
    ]


def upgrade() -> None:
    for statement in UPGRADE:
        op.execute(statement)


def downgrade() -> None:
    for table in ["sync_failures", "sync_state", "external_busy_blocks", "external_event_links", "external_calendars", "connected_accounts"]:
        op.execute(f"DROP TABLE IF EXISTS sched.{table} CASCADE")

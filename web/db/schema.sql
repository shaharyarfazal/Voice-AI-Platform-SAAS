-- Every tenant-owned row carries tenant_id; all queries in the app filter on it.
-- gen_random_uuid() is built into PostgreSQL 13+.

CREATE TABLE IF NOT EXISTS tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email          text NOT NULL UNIQUE,
  password_hash  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             text NOT NULL,
  greeting         text NOT NULL,
  system_prompt    text NOT NULL,
  voice_id         text NOT NULL,
  language         text NOT NULL DEFAULT 'en-US',
  llm_model        text NOT NULL DEFAULT 'gpt-4.1-mini',
  transfer_number  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agents_tenant_idx ON agents(tenant_id);

CREATE TABLE IF NOT EXISTS phone_numbers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  e164        text NOT NULL UNIQUE,
  carrier     text NOT NULL CHECK (carrier IN ('telnyx', 'twilio')),
  agent_id    uuid REFERENCES agents(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS phone_numbers_tenant_idx ON phone_numbers(tenant_id);

CREATE TABLE IF NOT EXISTS calls (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id          uuid REFERENCES agents(id) ON DELETE SET NULL,
  room_name         text NOT NULL UNIQUE,
  channel           text NOT NULL CHECK (channel IN ('phone', 'web')),
  from_number       text,
  to_number         text,
  started_at        timestamptz NOT NULL,
  ended_at          timestamptz NOT NULL,
  duration_seconds  integer NOT NULL,
  outcome           text NOT NULL,
  transcript        jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS calls_tenant_started_idx ON calls(tenant_id, started_at DESC);

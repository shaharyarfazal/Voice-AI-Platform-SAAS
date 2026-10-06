import "server-only";
import { sql } from "./db";

// Ordered schema changes, applied once each at server start (see instrumentation.ts).
// Never edit a migration that has shipped; add a new one.
const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: "0001_initial",
    sql: `
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
    `,
  },
  {
    id: "0002_admin_billing_compliance",
    sql: `
      ALTER TABLE tenants
        ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
        ADD COLUMN IF NOT EXISTS price_per_minute numeric(10,4) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS monthly_fee numeric(10,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS monthly_minute_limit integer,
        ADD COLUMN IF NOT EXISTS transcript_retention_days integer NOT NULL DEFAULT 90,
        ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS is_platform_admin boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
        ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
      ALTER TABLE agents
        ADD COLUMN IF NOT EXISTS announce_ai boolean NOT NULL DEFAULT true;
      ALTER TABLE calls
        ADD COLUMN IF NOT EXISTS stt_seconds real NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS llm_input_tokens integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS llm_output_tokens integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS tts_characters integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS transcript_purged_at timestamptz;
      CREATE INDEX IF NOT EXISTS calls_started_idx ON calls(started_at DESC);
      CREATE TABLE IF NOT EXISTS live_calls (
        room_name    text PRIMARY KEY,
        tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        agent_id     uuid REFERENCES agents(id) ON DELETE SET NULL,
        channel      text NOT NULL,
        from_number  text,
        started_at   timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS platform_settings (
        key         text PRIMARY KEY,
        value       jsonb NOT NULL,
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
  {
    id: "0003_tools_integrations_providers",
    sql: `
      -- Per-agent provider chains, tools and guardrails (JSON so new options don't need migrations).
      ALTER TABLE agents
        ADD COLUMN IF NOT EXISTS providers jsonb NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS tools jsonb NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS guardrails jsonb NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS booking jsonb NOT NULL DEFAULT '{}';

      -- OAuth connections (Google, Microsoft). Tokens are encrypted by the app (lib/crypto.ts).
      CREATE TABLE IF NOT EXISTS integrations (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        provider           text NOT NULL CHECK (provider IN ('google', 'microsoft')),
        account_email      text NOT NULL,
        access_token_enc   text NOT NULL,
        refresh_token_enc  text,
        expires_at         timestamptz NOT NULL,
        scopes             text NOT NULL DEFAULT '',
        status             text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'error')),
        last_error         text,
        created_at         timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, provider, account_email)
      );

      CREATE TABLE IF NOT EXISTS appointments (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        agent_id          uuid REFERENCES agents(id) ON DELETE SET NULL,
        integration_id    uuid REFERENCES integrations(id) ON DELETE SET NULL,
        room_name         text,
        starts_at         timestamptz NOT NULL,
        ends_at           timestamptz NOT NULL,
        timezone          text NOT NULL,
        customer_name     text NOT NULL,
        customer_phone    text,
        customer_email    text,
        notes             text NOT NULL DEFAULT '',
        external_event_id text,
        created_at        timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS appointments_tenant_starts_idx ON appointments(tenant_id, starts_at DESC);

      -- Users created through Google/Microsoft sign-in have no password.
      ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
    `,
  },
  {
    id: "0004_call_latency",
    sql: `
      -- Response time per call: average/p90 from caller stops speaking to agent starts, plus parts.
      ALTER TABLE calls ADD COLUMN IF NOT EXISTS latency jsonb NOT NULL DEFAULT '{}';
    `,
  },
  {
    id: "0005_recordings_webhooks_analysis",
    sql: `
      -- Recording, post-call analysis and webhook settings per agent.
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS post_call jsonb NOT NULL DEFAULT '{}';
      -- The agent worker picks the call id when the call starts, so every webhook carries the same id.
      ALTER TABLE live_calls
        ADD COLUMN IF NOT EXISTS call_id uuid,
        ADD COLUMN IF NOT EXISTS to_number text;
      ALTER TABLE calls
        ADD COLUMN IF NOT EXISTS has_recording boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS analysis jsonb;
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        call_id       uuid NOT NULL,
        event         text NOT NULL,
        url           text NOT NULL,
        attempts      integer NOT NULL DEFAULT 0,
        status_code   integer,
        error         text,
        delivered_at  timestamptz,
        created_at    timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS webhook_deliveries_call_idx ON webhook_deliveries(call_id, created_at);
    `,
  },
];

export async function migrate(): Promise<void> {
  // The advisory lock keeps two server processes from migrating at once.
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(727274)`;
    await tx`CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const applied = new Set((await tx<{ id: string }[]>`SELECT id FROM schema_migrations`).map((r) => r.id));
    for (const m of MIGRATIONS) {
      if (applied.has(m.id)) continue;
      await tx.unsafe(m.sql);
      await tx`INSERT INTO schema_migrations (id) VALUES (${m.id})`;
      console.log(`applied migration ${m.id}`);
    }
  });
}

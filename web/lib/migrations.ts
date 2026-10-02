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

import postgres from "postgres";

declare global {
  var __sql: ReturnType<typeof postgres> | undefined;
}

// Serverless functions each hold their own pool, so they keep it small and close idle connections;
// point DATABASE_URL at the provider's connection pooler (Neon, Supabase) there. Transaction-mode
// poolers (PgBouncer, Supabase port 6543) don't support prepared statements: set DATABASE_PREPARE=false.
const serverless = Boolean(process.env.VERCEL);
const options = {
  max: Number(process.env.DATABASE_POOL_MAX) || (serverless ? 3 : 10),
  idle_timeout: serverless ? 20 : undefined,
  prepare: process.env.DATABASE_PREPARE !== "false",
  onnotice: () => {},
};

// Reuse one pool across hot reloads in development.
export const sql = globalThis.__sql ?? postgres(process.env.DATABASE_URL!, options);
if (process.env.NODE_ENV !== "production") globalThis.__sql = sql;

export type AgentRow = {
  id: string;
  tenant_id: string;
  name: string;
  greeting: string;
  system_prompt: string;
  voice_id: string;
  language: string;
  llm_model: string;
  transfer_number: string | null;
  announce_ai: boolean;
};

export type CallRow = {
  id: string;
  agent_id: string | null;
  agent_name: string | null;
  room_name: string;
  channel: "phone" | "web";
  direction?: "inbound" | "outbound" | "web";
  from_number: string | null;
  to_number: string | null;
  started_at: Date;
  ended_at: Date;
  duration_seconds: number;
  outcome: string;
  transcript: { role: "user" | "assistant" | "tool"; text: string; at: string }[];
  transcript_purged_at: Date | null;
  latency: import("@/components/latency").Latency;
  has_recording: boolean;
  analysis: import("./webhooks").CallAnalysis | null;
};

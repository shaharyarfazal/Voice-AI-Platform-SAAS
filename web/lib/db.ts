import postgres from "postgres";

declare global {
  var __sql: ReturnType<typeof postgres> | undefined;
}

// Serverless functions each hold their own pool, so they keep it small and close idle connections;
// point DATABASE_URL at the provider's connection pooler (Neon, Supabase) there. On Supabase use the
// session pooler (port 5432), not the transaction pooler (6543): without prepared statements this
// driver sends each query with parameters as Parse/Describe/Flush first, and the transaction pooler
// sometimes never answers that, leaving the query (and the page) hanging until the function times out.
const serverless = Boolean(process.env.VERCEL);
const options = {
  max: Number(process.env.DATABASE_POOL_MAX) || (serverless ? 3 : 10),
  // The session pooler admits a fixed number of clients (15 on small Supabase plans), so hand idle
  // connections back quickly: within seconds on serverless, where many instances share that limit.
  idle_timeout: serverless ? 5 : 60,
  // Fail fast instead of waiting on an unreachable database.
  connect_timeout: 10,
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

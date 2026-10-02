import postgres from "postgres";

declare global {
  var __sql: ReturnType<typeof postgres> | undefined;
}

// Reuse one pool across hot reloads in development.
export const sql = globalThis.__sql ?? postgres(process.env.DATABASE_URL!, { max: 10, onnotice: () => {} });
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
  from_number: string | null;
  to_number: string | null;
  started_at: Date;
  ended_at: Date;
  duration_seconds: number;
  outcome: string;
  transcript: { role: "user" | "assistant"; text: string; at: string }[];
  transcript_purged_at: Date | null;
};

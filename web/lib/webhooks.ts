import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { parsePostCall, type WebhookEvent } from "./agent-settings";
import { sql } from "./db";
import { assertPublicHttpsUrl } from "./net";
import { signedRecordingUrl } from "./recordings";

// Webhooks: call_started, call_ended and call_analyzed, POSTed to the agent's webhook URL as JSON
// and signed with the client's secret. Failed deliveries are retried twice (after 10 s and 60 s).

const RETRY_DELAYS_MS = [10_000, 60_000];

/** Per-client signing secret, derived from the server secret so nothing extra is stored. */
export function webhookSecret(tenantId: string): string {
  return "whsec_" + createHmac("sha256", process.env.SESSION_SECRET!).update(`webhook:${tenantId}`).digest("hex").slice(0, 48);
}

/** `v1=<hex HMAC-SHA256 of "<timestamp>.<body>">`, the same scheme as Stripe-style webhooks. */
export function signPayload(secret: string, timestamp: number, body: string): string {
  return "v1=" + createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

type Turn = { role: "user" | "assistant" | "tool"; text: string; at: string };

export type CallAnalysis = {
  summary: string;
  user_sentiment: "positive" | "neutral" | "negative" | "unknown";
  call_successful: boolean | null;
  custom_data: Record<string, unknown>;
};

export type WebhookCall = {
  call_id: string;
  agent_id: string | null;
  agent_name: string | null;
  /** "inbound" phone call, "outbound" phone call, or "web" test call from the dashboard. */
  direction: "inbound" | "outbound" | "web";
  from_number: string | null;
  to_number: string | null;
  start_timestamp: string;
  end_timestamp?: string;
  duration_seconds?: number;
  /** Why the call ended: caller_hung_up, completed (the agent ended it), transferred, silence_timeout, time_limit, error */
  end_reason?: string;
  /** Plain text, one line per turn: "Agent: ..." / "User: ...". */
  transcript?: string;
  transcript_object?: { role: "agent" | "user" | "tool"; content: string; timestamp: string }[];
  recording_url?: string | null;
  recording_url_expires_at?: string | null;
  call_analysis?: CallAnalysis | null;
};

const ROLE = { user: "user", assistant: "agent", tool: "tool" } as const;

export function transcriptFields(turns: Turn[]) {
  const spoken = turns.filter((t) => t.role !== "tool");
  return {
    transcript: spoken.map((t) => `${t.role === "user" ? "User" : "Agent"}: ${t.text}`).join("\n"),
    transcript_object: turns.map((t) => ({ role: ROLE[t.role], content: t.text, timestamp: t.at })),
  };
}

type CallRecord = {
  id: string;
  tenant_id: string;
  agent_id: string | null;
  agent_name: string | null;
  channel: "phone" | "web";
  from_number: string | null;
  to_number: string | null;
  started_at: Date;
  ended_at: Date;
  duration_seconds: number;
  outcome: string;
  transcript: Turn[];
  has_recording: boolean;
  analysis: CallAnalysis | null;
};

/** The full call as sent in call_ended and call_analyzed. */
export async function loadWebhookCall(callId: string): Promise<{ tenantId: string; agentId: string | null; call: WebhookCall } | null> {
  const [c] = await sql<CallRecord[]>`
    SELECT c.*, a.name AS agent_name FROM calls c LEFT JOIN agents a ON a.id = c.agent_id WHERE c.id = ${callId}`;
  if (!c) return null;
  const recording = c.has_recording ? signedRecordingUrl(c.id) : null;
  return {
    tenantId: c.tenant_id,
    agentId: c.agent_id,
    call: {
      call_id: c.id,
      agent_id: c.agent_id,
      agent_name: c.agent_name,
      direction: c.channel === "web" ? "web" : "inbound",
      from_number: c.from_number,
      to_number: c.to_number,
      start_timestamp: c.started_at.toISOString(),
      end_timestamp: c.ended_at.toISOString(),
      duration_seconds: c.duration_seconds,
      end_reason: c.outcome,
      ...transcriptFields(c.transcript),
      recording_url: recording?.url ?? null,
      recording_url_expires_at: recording?.expiresAt ?? null,
      call_analysis: c.analysis,
    },
  };
}

type Delivery = { status: number | null; error: string | null };

/** One POST. Never follows redirects, never throws. */
export async function postWebhook(url: string, secret: string, event: string, body: unknown, deliveryId: string): Promise<Delivery> {
  try {
    await assertPublicHttpsUrl(url);
    const json = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000);
    const res = await fetch(url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "content-type": "application/json",
        "user-agent": "VoiceAgentWebhooks/1.0",
        "x-webhook-event": event,
        "x-webhook-id": deliveryId,
        "x-webhook-timestamp": String(timestamp),
        "x-webhook-signature": signPayload(secret, timestamp, json),
      },
      body: json,
    });
    await res.body?.cancel().catch(() => {});
    return { status: res.status, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (e) {
    return { status: null, error: e instanceof Error ? e.message.slice(0, 300) : "Request failed" };
  }
}

/** Sends the event if the agent has a webhook for it. Runs in the background; returns at once. */
export function dispatchWebhook(agentId: string | null, event: WebhookEvent, callId: string, build: () => Promise<WebhookCall | null>): void {
  void (async () => {
    if (!agentId) return;
    const [agent] = await sql<{ tenant_id: string; post_call: unknown }[]>`SELECT tenant_id, post_call FROM agents WHERE id = ${agentId}`;
    if (!agent) return;
    const settings = parsePostCall(agent.post_call);
    if (!settings.webhookUrl || !settings.webhookEvents.includes(event)) return;
    const call = await build();
    if (!call) return;

    const body = { event, call };
    const secret = webhookSecret(agent.tenant_id);
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO webhook_deliveries (tenant_id, call_id, event, url)
      VALUES (${agent.tenant_id}, ${callId}, ${event}, ${settings.webhookUrl}) RETURNING id`;

    for (let attempt = 0; ; attempt++) {
      const result = await postWebhook(settings.webhookUrl, secret, event, body, row.id);
      const ok = result.error === null;
      await sql`
        UPDATE webhook_deliveries SET attempts = ${attempt + 1}, status_code = ${result.status}, error = ${result.error},
          delivered_at = ${ok ? new Date() : null}
        WHERE id = ${row.id}`;
      if (ok || attempt >= RETRY_DELAYS_MS.length) return;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  })().catch((e) => console.error(`webhook ${event} for call ${callId} failed`, e));
}

/** Sample call_ended payload for the "Send test" button. */
export function sampleCall(agentId: string, agentName: string): WebhookCall {
  const end = new Date();
  const start = new Date(end.getTime() - 95_000);
  const turns: Turn[] = [
    { role: "assistant", text: "Thanks for calling! How can I help you today?", at: start.toISOString() },
    { role: "user", text: "Hi, I'd like to book an appointment for Friday.", at: new Date(start.getTime() + 4000).toISOString() },
    { role: "assistant", text: "Of course. Friday at 10 or 2, which suits you?", at: new Date(start.getTime() + 7000).toISOString() },
  ];
  return {
    call_id: randomUUID(),
    agent_id: agentId,
    agent_name: agentName,
    direction: "inbound",
    from_number: "+14155550100",
    to_number: "+14155550199",
    start_timestamp: start.toISOString(),
    end_timestamp: end.toISOString(),
    duration_seconds: 95,
    end_reason: "completed",
    ...transcriptFields(turns),
    recording_url: null,
    recording_url_expires_at: null,
    call_analysis: {
      summary: "The caller asked to book an appointment on Friday and was offered 10 am or 2 pm.",
      user_sentiment: "positive",
      call_successful: true,
      custom_data: {},
    },
  };
}

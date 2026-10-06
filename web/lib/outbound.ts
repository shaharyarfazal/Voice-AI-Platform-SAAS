import "server-only";
import { SIPOutboundConfig } from "@livekit/protocol";
import { AgentDispatchClient, SipClient } from "livekit-server-sdk";
import { sql } from "./db";
import { AGENT_NAME } from "./livekit";
import { isE164 } from "./validation";

// Outbound calls: LiveKit dials the number through the carrier that owns the caller ID (Telnyx or
// Twilio, with SIP credentials from the environment) and the agent joins the same room. The agent
// waits until the call is answered before it speaks.

const MAX_LIVE_OUTBOUND = 10;

type Carrier = "telnyx" | "twilio";

function carrierConfig(carrier: Carrier): SIPOutboundConfig | null {
  const env = process.env;
  const c =
    carrier === "telnyx"
      ? { hostname: env.TELNYX_SIP_DOMAIN || "sip.telnyx.com", user: env.TELNYX_SIP_USERNAME, pass: env.TELNYX_SIP_PASSWORD }
      : { hostname: env.TWILIO_SIP_DOMAIN, user: env.TWILIO_SIP_USERNAME, pass: env.TWILIO_SIP_PASSWORD };
  if (!c.hostname || !c.user || !c.pass) return null;
  return new SIPOutboundConfig({ hostname: c.hostname, authUsername: c.user, authPassword: c.pass });
}

export function outboundConfigured(): Carrier[] {
  return (["telnyx", "twilio"] as const).filter((c) => carrierConfig(c) !== null);
}

const livekitHost = () => process.env.LIVEKIT_HTTP_URL || "http://127.0.0.1:7880";

export type OutboundRequest = {
  tenantId: string;
  agentId: string;
  to: string;
  /** Caller ID: one of the workspace's numbers. Defaults to the first one. */
  from?: string | null;
  /** Facts about the person being called, given to the agent (e.g. name, appointment time). */
  variables?: Record<string, string>;
};

export type OutboundResult = { callId: string; roomName: string; from: string; to: string } | { error: string; status: number };

export async function startOutboundCall(req: OutboundRequest): Promise<OutboundResult> {
  const to = req.to.replace(/[\s()-]/g, "");
  if (!isE164(to)) return { error: "The number to call must be in E.164 format, like +14155550100.", status: 400 };

  const [agent] = await sql<{ id: string; type: string; tenant_status: string; limit: number | null; used: number }[]>`
    SELECT a.id, a.type, t.status AS tenant_status, t.monthly_minute_limit AS limit,
      (SELECT coalesce(sum(duration_seconds), 0)::int / 60 FROM calls WHERE tenant_id = t.id AND started_at >= date_trunc('month', now())) AS used
    FROM agents a JOIN tenants t ON t.id = a.tenant_id WHERE a.id = ${req.agentId} AND a.tenant_id = ${req.tenantId}`;
  if (!agent) return { error: "Agent not found.", status: 404 };
  if (agent.type === "chat") return { error: "Chatbots can't make phone calls. Use a voice agent.", status: 400 };
  if (agent.tenant_status !== "active") return { error: "This workspace is suspended.", status: 403 };
  if (agent.limit !== null && agent.used >= agent.limit) return { error: "The monthly minute limit has been reached.", status: 403 };

  const numbers = await sql<{ e164: string; carrier: Carrier }[]>`SELECT e164, carrier FROM phone_numbers WHERE tenant_id = ${req.tenantId} ORDER BY created_at`;
  const from = req.from ? numbers.find((n) => n.e164 === req.from) : numbers[0];
  if (!from) return { error: req.from ? "Caller ID must be one of your phone numbers." : "Add a phone number first: it's used as the caller ID.", status: 400 };
  const trunk = carrierConfig(from.carrier);
  if (!trunk) return { error: `Outbound calling through ${from.carrier} isn't set up on this server yet (see docs/telephony.md).`, status: 503 };

  const [live] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM live_calls WHERE tenant_id = ${req.tenantId} AND direction = 'outbound'`;
  if (live.n >= MAX_LIVE_OUTBOUND) return { error: `At most ${MAX_LIVE_OUTBOUND} outbound calls can run at once.`, status: 429 };

  const callId = crypto.randomUUID();
  const roomName = `out-${callId.slice(0, 13)}`;
  const variables = Object.fromEntries(
    Object.entries(req.variables ?? {})
      .slice(0, 30)
      .map(([k, v]) => [k.slice(0, 50), String(v).slice(0, 500)]),
  );
  const metadata = JSON.stringify({ agentId: agent.id, callId, direction: "outbound", to, from: from.e164, variables });
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;

  try {
    await new AgentDispatchClient(livekitHost(), key, secret).createDispatch(roomName, AGENT_NAME, { metadata });
    await new SipClient(livekitHost(), key, secret).createSipParticipant(
      "",
      to,
      roomName,
      { fromNumber: from.e164, participantIdentity: `callee-${to}`, participantName: to, ringingTimeout: 45, maxCallDuration: 60 * 60, playDialtone: false },
      trunk,
    );
  } catch (e) {
    console.error("outbound call failed", e);
    return { error: "The call couldn't be placed. Check the carrier's outbound settings and the number.", status: 502 };
  }
  return { callId, roomName, from: from.e164, to };
}

import "server-only";
import { parseBooking, parseTools } from "../agent-settings";
import { bookAppointment, checkAvailability } from "../booking-service";
import { decrypt } from "../crypto";
import { formatHits, searchKnowledge } from "../knowledge/search";
import { assertPublicHttpsUrl } from "../net";

// The tools a chatbot can use: the same knowledge base, calendar and custom functions as the
// voice agent (ending or transferring a call doesn't apply to chat).

export type ToolDef = { name: string; description: string; parameters: Record<string, unknown> };
export type ToolCtx = { agentId: string; tenantId: string; sessionId: string; visitor: Record<string, unknown> };
type Tool = ToolDef & { run: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<string> };

const MAX_RESULT = 6000;

type AgentForTools = { id: string; tenant_id: string; tools: unknown; booking: unknown; knowledge_base_ids?: string[] };

export function chatTools(agent: AgentForTools): Tool[] {
  const tools = parseTools(agent.tools);
  const booking = parseBooking(agent.booking);
  const list: Tool[] = [];

  if (agent.knowledge_base_ids?.length) {
    list.push({
      name: "search_knowledge_base",
      description:
        "Look up information about the business: services, prices, opening hours, location, policies, products, FAQs. Use it before answering any question about the business.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "What to look up, as a short question or keywords." } },
        required: ["query"],
      },
      run: async (args, ctx) => formatHits(await searchKnowledge(ctx.tenantId, agent.knowledge_base_ids!, String(args.query ?? ""), 4)),
    });
  }

  if (tools.booking && booking.integrationId) {
    list.push(
      {
        name: "check_availability",
        description: "Find open appointment times on a day.",
        parameters: { type: "object", properties: { date: { type: "string", description: "The day to check, as YYYY-MM-DD." } }, required: ["date"] },
        run: async (args) => {
          const r = await checkAvailability(agent.id, String(args.date ?? ""));
          return r.message + (r.slots?.length ? ` Exact times to use when booking: ${r.slots.map((s: { start: string }) => s.start).join(", ")}` : "");
        },
      },
      {
        name: "book_appointment",
        description:
          "Book an appointment at a time returned by check_availability. Only call this after the visitor confirmed the day, time and their name.",
        parameters: {
          type: "object",
          properties: {
            start_time: { type: "string", description: "One of the exact times from check_availability." },
            name: { type: "string", description: "The visitor's full name." },
            email: { type: "string", description: "Email for the calendar invitation, if they want one." },
            phone: { type: "string", description: "Phone number, if given." },
            notes: { type: "string", description: "Anything the business should know." },
          },
          required: ["start_time", "name"],
        },
        run: async (args, ctx) => {
          const r = await bookAppointment({
            agentId: agent.id,
            start: String(args.start_time ?? ""),
            name: String(args.name ?? "").slice(0, 200),
            phone: args.phone ? String(args.phone).slice(0, 40) : null,
            email: args.email ? String(args.email).slice(0, 200) : null,
            notes: args.notes ? String(args.notes).slice(0, 1000) : undefined,
            roomName: `chat-${ctx.sessionId}`,
          });
          return r.message;
        },
      },
    );
  }

  for (const fn of tools.custom) {
    list.push({
      name: fn.name,
      description: fn.description,
      parameters: (fn.parameters as Record<string, unknown>) ?? { type: "object", properties: {} },
      run: async (args, ctx) => {
        try {
          await assertPublicHttpsUrl(fn.url);
        } catch {
          return `The ${fn.name} service isn't available. Tell the visitor you couldn't complete that.`;
        }
        const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "voice-agent/1.0" };
        if (fn.authorizationEnc) {
          try {
            headers.authorization = decrypt(fn.authorizationEnc);
          } catch {
            // a key rotated since saving: call without it
          }
        }
        try {
          const res = await fetch(fn.url, {
            method: "POST",
            redirect: "manual",
            signal: AbortSignal.timeout(10_000),
            headers,
            body: JSON.stringify({ function: fn.name, arguments: args, call: { agentId: agent.id, chat: ctx.sessionId, channel: "chat" } }),
          });
          const text = (await res.text()).slice(0, MAX_RESULT);
          return res.ok ? text || "Done." : `The ${fn.name} service returned an error. Tell the visitor you couldn't complete that.`;
        } catch {
          return `The ${fn.name} service didn't respond. Tell the visitor you couldn't complete that.`;
        }
      },
    });
  }
  return list;
}

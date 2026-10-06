import { parseBooking, parseGuardrails, parsePostCall, parseTools } from "@/lib/agent-settings";
import { resolveProviders } from "@/lib/catalog";
import type { EditorState } from "./types";

export const DEFAULT_PROMPT = `You are the friendly receptionist for {business name}, answering the phone.

Business information:
- Hours: ...
- Address: ...
- Services and prices: ...

Ask one question at a time. If you don't know something, say so and offer to take a message or transfer the call.`;

type Row = {
  type?: string;
  knowledge_base_ids?: string[];
  name: string;
  greeting: string;
  system_prompt: string;
  announce_ai: boolean;
  language: string;
  llm_model: string;
  voice_id: string;
  transfer_number: string | null;
  providers: unknown;
  tools: unknown;
  booking: unknown;
  guardrails: unknown;
  post_call?: unknown;
};

/** Server-side: an agent row (or nothing, for a new agent) as editor state. Secrets are never sent. */
export function toEditorState(row?: Row, browserTimezone = "UTC", type: EditorState["type"] = "inbound"): EditorState {
  const tools = parseTools(row?.tools);
  const booking = parseBooking(row?.booking);
  const agentType = (row?.type as EditorState["type"]) ?? type;
  return {
    type: agentType,
    knowledgeBaseIds: row?.knowledge_base_ids ?? [],
    name: row?.name ?? "",
    greeting: row?.greeting ?? (agentType === "chat" ? "Hi! How can I help you today?" : "Thanks for calling! How can I help you today?"),
    systemPrompt: row?.system_prompt ?? DEFAULT_PROMPT,
    announceAi: row?.announce_ai ?? true,
    language: row?.language ?? "en-US",
    providers: resolveProviders(row?.providers as never, {
      llm_model: row?.llm_model ?? "gpt-4.1-mini",
      voice_id: row?.voice_id ?? "f786b574-daa5-4673-aa0c-cbe3e8534c02",
    }),
    transferNumber: row?.transfer_number ?? "",
    tools: {
      endCall: tools.endCall,
      transferCall: tools.transferCall && Boolean(row?.transfer_number),
      booking: tools.booking,
      custom: tools.custom.map((f) => ({
        name: f.name,
        description: f.description,
        url: f.url,
        parametersText: JSON.stringify(f.parameters, null, 2),
        speakBefore: f.speakBefore,
        authorization: "",
        hasAuthorization: Boolean(f.authorizationEnc),
        keepAuthorization: Boolean(f.authorizationEnc),
      })),
      mcp: tools.mcp.map((m) => ({
        name: m.name,
        url: m.url,
        allowedToolsText: m.allowedTools.join(", "),
        authorization: "",
        hasAuthorization: Boolean(m.authorizationEnc),
        keepAuthorization: Boolean(m.authorizationEnc),
      })),
    },
    booking: row ? booking : { ...booking, timezone: browserTimezone },
    guardrails: parseGuardrails(row?.guardrails),
    postCall: parsePostCall(row?.post_call),
  };
}

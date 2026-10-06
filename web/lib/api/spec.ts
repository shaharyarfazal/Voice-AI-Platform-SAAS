// The public REST API, described once: the docs page and the OpenAPI file are generated from this,
// and the router checks every route it serves is listed here.

export type Field = { name: string; type: string; required?: boolean; description: string };
export type Endpoint = {
  id: string;
  group: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  summary: string;
  description?: string;
  query?: Field[];
  body?: Field[];
  example?: unknown;
  response: unknown;
};

const AGENT = {
  id: "8c0f1d9e-3a52-4b0e-9f4f-1f2a3b4c5d6e",
  name: "Front desk",
  type: "inbound",
  greeting: "Thanks for calling Smile Dental! How can I help?",
  systemPrompt: "You are the receptionist for Smile Dental…",
  language: "en-US",
  announceAi: true,
  transferNumber: "+14155550100",
  providers: {
    mode: "pipeline",
    stt: { provider: "deepgram", model: "nova-3" },
    llm: { provider: "openai", model: "gpt-4.1-mini" },
    tts: { provider: "cartesia", model: "sonic-3", voice: "f786b574-daa5-4673-aa0c-cbe3e8534c02" },
    realtime: { model: "gpt-realtime", voice: "marin" },
  },
  tools: { endCall: true, transferCall: true, booking: false, custom: [], mcp: [] },
  guardrails: { allowedTopics: "", forbidden: "", maxCallMinutes: 15, silenceTimeoutSeconds: 20, blockedPhrases: [], noiseProfile: "standard", responseSpeed: "balanced" },
  postCall: { recordCalls: true, webhookUrl: "https://n8n.example.com/webhook/calls", webhookEvents: ["call_started", "call_ended", "call_analyzed"], successCriteria: "", analysisFields: [] },
  knowledgeBaseIds: ["2b1c…"],
  createdAt: "2026-10-06T12:00:00.000Z",
  updatedAt: "2026-10-06T12:00:00.000Z",
};

const CALL = {
  call_id: "82980c6d-3f0e-4c1a-9d43-0f2a51b8e9a1",
  agent_id: AGENT.id,
  agent_name: "Front desk",
  direction: "inbound",
  from_number: "+14155550123",
  to_number: "+14155550199",
  start_timestamp: "2026-10-06T16:53:25.366Z",
  end_timestamp: "2026-10-06T16:55:00.120Z",
  duration_seconds: 95,
  end_reason: "completed",
  transcript: "Agent: Thanks for calling!…\nUser: I'd like to book Friday.",
  transcript_object: [{ role: "agent", content: "Thanks for calling!…", timestamp: "2026-10-06T16:53:26.010Z" }],
  recording_url: "https://app.example.com/api/recordings/82980c6d…?expires=…&signature=…",
  recording_url_expires_at: "2026-10-13T16:55:00.000Z",
  call_analysis: { summary: "The caller booked Friday 10 am.", user_sentiment: "positive", call_successful: true, custom_data: { customer_name: "Sara Khan" } },
};

export const ENDPOINTS: Endpoint[] = [
  // Agents
  {
    id: "list-agents", group: "Agents", method: "GET", path: "/v1/agents", summary: "List agents",
    description: "All voice agents and chatbots in the workspace.",
    query: [{ name: "type", type: "string", description: "Only this type: inbound, outbound or chat." }],
    response: { data: [AGENT] },
  },
  {
    id: "create-agent", group: "Agents", method: "POST", path: "/v1/agents", summary: "Create an agent",
    description: "Send the same shape the export gives (or just the required fields). Provider, tool and guardrail settings are optional and default sensibly.",
    body: [
      { name: "name", type: "string", required: true, description: "Shown in the dashboard." },
      { name: "type", type: "string", description: "inbound (default), outbound or chat." },
      { name: "greeting", type: "string", required: true, description: "First thing said (or the chat's first message)." },
      { name: "systemPrompt", type: "string", required: true, description: "Instructions: the business, what to do, facts to share." },
      { name: "language", type: "string", description: "e.g. en-US, es, hi, or multi. Default en-US." },
      { name: "providers", type: "object", description: "Speech recognition, LLM, voice (or OpenAI Realtime) choices." },
      { name: "tools", type: "object", description: "endCall, transferCall, booking, custom functions, MCP servers." },
      { name: "postCall", type: "object", description: "Recording, webhook URL and events, analysis fields." },
    ],
    example: { name: "Front desk", type: "inbound", greeting: "Thanks for calling! How can I help?", systemPrompt: "You are the receptionist for Smile Dental…", language: "en-US" },
    response: AGENT,
  },
  { id: "get-agent", group: "Agents", method: "GET", path: "/v1/agents/{id}", summary: "Get an agent", response: AGENT },
  {
    id: "update-agent", group: "Agents", method: "PATCH", path: "/v1/agents/{id}", summary: "Update an agent",
    description: "Send only the fields to change. Custom functions keep their stored credentials unless you send a new `authorization` for them.",
    body: [
      { name: "name", type: "string", description: "" },
      { name: "greeting", type: "string", description: "" },
      { name: "systemPrompt", type: "string", description: "" },
      { name: "language", type: "string", description: "" },
      { name: "knowledgeBaseIds", type: "string[]", description: "Knowledge bases the agent searches." },
      { name: "providers / tools / guardrails / postCall", type: "object", description: "As in Create." },
    ],
    example: { systemPrompt: "You are the receptionist for Smile Dental. We're closed on public holidays…", knowledgeBaseIds: ["2b1c…"] },
    response: AGENT,
  },
  { id: "delete-agent", group: "Agents", method: "DELETE", path: "/v1/agents/{id}", summary: "Delete an agent", response: { deleted: true } },
  { id: "duplicate-agent", group: "Agents", method: "POST", path: "/v1/agents/{id}/duplicate", summary: "Duplicate an agent", description: "Copies everything, including credentials and knowledge links.", response: AGENT },
  {
    id: "export-agent", group: "Agents", method: "GET", path: "/v1/agents/{id}/export", summary: "Export an agent as JSON",
    description: "A portable file (no credentials, calendar or knowledge links) you can import into any workspace with Create.",
    response: { kind: "agent", version: 1, exportedAt: "2026-10-06T12:00:00.000Z", agent: { name: "Front desk", "…": "…" } },
  },

  // Calls
  {
    id: "list-calls", group: "Calls", method: "GET", path: "/v1/calls", summary: "List calls",
    description: "Newest first. Each call has the same fields as the call_ended webhook, without the transcript (get a single call for that).",
    query: [
      { name: "limit", type: "integer", description: "1-100, default 50." },
      { name: "before", type: "string", description: "Only calls that started before this ISO time (for paging)." },
      { name: "agent_id", type: "string", description: "Only this agent's calls." },
      { name: "direction", type: "string", description: "inbound, outbound or web." },
    ],
    response: { data: [{ ...CALL, transcript: undefined, transcript_object: undefined }], next_before: "2026-10-06T16:53:25.366Z" },
  },
  { id: "get-call", group: "Calls", method: "GET", path: "/v1/calls/{id}", summary: "Get a call", description: "Transcript, recording link (valid 7 days) and analysis.", response: CALL },
  {
    id: "create-call", group: "Calls", method: "POST", path: "/v1/calls", summary: "Make an outbound call",
    description: "The agent calls the number now and starts talking when it's answered. Webhooks report the call as it happens; the call_id is the same.",
    body: [
      { name: "agent_id", type: "string", required: true, description: "A voice agent (usually type outbound)." },
      { name: "to_number", type: "string", required: true, description: "E.164, e.g. +14155550100." },
      { name: "from_number", type: "string", description: "One of your numbers; default is your first." },
      { name: "variables", type: "object", description: "Facts for this call, e.g. {\"name\": \"Sara\", \"appointment\": \"Friday 10am\"}." },
    ],
    example: { agent_id: AGENT.id, to_number: "+14155550123", variables: { name: "Sara Khan", appointment: "Friday 10am" } },
    response: { call_id: CALL.call_id, status: "dialing", from_number: "+14155550199", to_number: "+14155550123" },
  },
  {
    id: "create-web-call", group: "Calls", method: "POST", path: "/v1/web-calls", summary: "Start a web call",
    description: "For your own app: returns a LiveKit room URL and token. Join with any LiveKit client SDK and the agent answers.",
    body: [{ name: "agent_id", type: "string", required: true, description: "The agent to talk to." }],
    example: { agent_id: AGENT.id },
    response: { room_name: "web-8c0f1d9e-1a2b3c4d", url: "wss://livekit.example.com", token: "eyJhbGciOi…", expires_in: 600 },
  },

  // Chats
  {
    id: "create-chat", group: "Chats", method: "POST", path: "/v1/chats", summary: "Start a chat",
    body: [
      { name: "agent_id", type: "string", required: true, description: "Any agent; chat type is designed for it." },
      { name: "metadata", type: "object", description: "Anything about the visitor, stored with the chat." },
    ],
    example: { agent_id: AGENT.id, metadata: { customer_id: "c_123" } },
    response: { chat_id: "5d3a…", greeting: "Hi! How can I help you today?" },
  },
  {
    id: "send-chat-message", group: "Chats", method: "POST", path: "/v1/chats/{id}/messages", summary: "Send a message",
    description: "Returns the agent's reply. The agent can search the knowledge base, book appointments and call your functions while answering.",
    body: [{ name: "text", type: "string", required: true, description: "Up to 2000 characters." }],
    example: { text: "Are you open on Saturday?" },
    response: { reply: "Yes, we're open Saturdays from 9am to 1pm. Would you like to book a time?" },
  },
  {
    id: "get-chat", group: "Chats", method: "GET", path: "/v1/chats/{id}", summary: "Get a chat",
    response: { chat_id: "5d3a…", agent_id: AGENT.id, channel: "api", started_at: "2026-10-06T12:00:00.000Z", messages: [{ role: "assistant", content: "Hi!", at: "…" }, { role: "user", content: "Are you open on Saturday?", at: "…" }] },
  },

  // Knowledge
  { id: "list-kbs", group: "Knowledge base", method: "GET", path: "/v1/knowledge-bases", summary: "List knowledge bases", response: { data: [{ id: "2b1c…", name: "Business knowledge", sources: 3, passages: 412 }] } },
  {
    id: "create-kb", group: "Knowledge base", method: "POST", path: "/v1/knowledge-bases", summary: "Create a knowledge base",
    body: [{ name: "name", type: "string", required: true, description: "" }], example: { name: "Business knowledge" },
    response: { id: "2b1c…", name: "Business knowledge" },
  },
  {
    id: "get-kb", group: "Knowledge base", method: "GET", path: "/v1/knowledge-bases/{id}", summary: "Get a knowledge base and its sources",
    response: { id: "2b1c…", name: "Business knowledge", sources: [{ id: "9f0e…", type: "website", title: "smiledental.com", url: "https://smiledental.com", status: "ready", pages: 24, passages: 380, error: null }] },
  },
  { id: "delete-kb", group: "Knowledge base", method: "DELETE", path: "/v1/knowledge-bases/{id}", summary: "Delete a knowledge base", response: { deleted: true } },
  {
    id: "add-source", group: "Knowledge base", method: "POST", path: "/v1/knowledge-bases/{id}/sources", summary: "Add a source",
    description: "JSON for a website, single page or text. To upload a file (PDF, DOCX, TXT, MD, CSV, up to 25 MB), send multipart/form-data with a `file` field instead. Sources are processed in the background: poll Get a knowledge base for `status`.",
    body: [
      { name: "type", type: "string", required: true, description: "website (crawls the site), url (one page or PDF) or text." },
      { name: "url", type: "string", description: "For website and url." },
      { name: "max_pages", type: "integer", description: "For website: 1-200, default 30." },
      { name: "title", type: "string", description: "For text." },
      { name: "text", type: "string", description: "For text." },
    ],
    example: { type: "website", url: "https://smiledental.com", max_pages: 50 },
    response: { id: "9f0e…", status: "queued" },
  },
  { id: "delete-source", group: "Knowledge base", method: "DELETE", path: "/v1/knowledge-bases/{id}/sources/{source_id}", summary: "Delete a source", response: { deleted: true } },
  {
    id: "search-kb", group: "Knowledge base", method: "POST", path: "/v1/knowledge-bases/{id}/search", summary: "Search",
    body: [
      { name: "query", type: "string", required: true, description: "A question or keywords." },
      { name: "limit", type: "integer", description: "1-10, default 5." },
    ],
    example: { query: "Do you take walk-ins?" },
    response: { data: [{ content: "Walk-ins are welcome Monday to Friday…", title: "FAQ", url: "https://smiledental.com/faq", score: 0.82 }] },
  },

  // Other
  { id: "list-numbers", group: "Phone numbers", method: "GET", path: "/v1/phone-numbers", summary: "List phone numbers", response: { data: [{ number: "+14155550199", carrier: "telnyx", agent_id: AGENT.id }] } },
  {
    id: "list-widgets", group: "Widgets", method: "GET", path: "/v1/widgets", summary: "List widgets",
    response: { data: [{ id: "77aa…", name: "Website widget", agent_id: AGENT.id, mode: "both", public_key: "wpk_…", allowed_origins: ["https://smiledental.com"], enabled: true }] },
  },
];

/** "/v1/agents/{id}" -> regex with named groups. */
export function pathPattern(path: string): RegExp {
  return new RegExp(`^${path.replace(/\{(\w+)\}/g, "(?<$1>[^/]+)")}$`);
}

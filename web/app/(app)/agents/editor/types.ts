import type { Booking, Guardrails, PostCall } from "@/lib/agent-settings";
import type { AgentProviders } from "@/lib/catalog";

export type EditorFunction = {
  name: string;
  description: string;
  url: string;
  parametersText: string;
  speakBefore: string;
  authorization: string;
  hasAuthorization: boolean;
  keepAuthorization: boolean;
};

export type EditorMcp = {
  name: string;
  url: string;
  allowedToolsText: string;
  authorization: string;
  hasAuthorization: boolean;
  keepAuthorization: boolean;
};

export type EditorState = {
  name: string;
  greeting: string;
  systemPrompt: string;
  announceAi: boolean;
  language: string;
  providers: AgentProviders;
  transferNumber: string;
  tools: { endCall: boolean; transferCall: boolean; booking: boolean; custom: EditorFunction[]; mcp: EditorMcp[] };
  booking: Booking;
  guardrails: Guardrails;
  postCall: PostCall;
};

export type EditorContext = {
  integrations: { id: string; provider: "google" | "microsoft"; account_email: string }[];
  /** Providers with API keys on the agent worker. */
  available: { stt: string[]; llm: string[]; tts: string[] };
  timezones: string[];
  /** Voices in the platform's ElevenLabs account; null when unknown. */
  elevenlabsVoices: { id: string; name: string; category: string }[] | null;
  /** Signs this client's webhooks. */
  webhookSecret: string;
};

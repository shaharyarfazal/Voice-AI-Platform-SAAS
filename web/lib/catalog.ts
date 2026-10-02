// Languages and AI providers the platform supports. The agent worker reports which providers have
// API keys (see /api/internal/worker); only those are offered in the agent editor.

export type Role = "stt" | "llm" | "tts";

export type Language = { code: string; label: string };

// Deepgram nova-3 language codes (the primary speech-to-text); "multi" lets callers switch languages.
export const LANGUAGES: Language[] = [
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "en-AU", label: "English (Australia)" },
  { code: "en-IN", label: "English (India)" },
  { code: "multi", label: "Multilingual: detect the caller's language" },
  { code: "es", label: "Spanish" },
  { code: "es-419", label: "Spanish (Latin America)" },
  { code: "fr", label: "French" },
  { code: "fr-CA", label: "French (Canada)" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "nl", label: "Dutch" },
  { code: "sv", label: "Swedish" },
  { code: "da", label: "Danish" },
  { code: "no", label: "Norwegian" },
  { code: "pl", label: "Polish" },
  { code: "ru", label: "Russian" },
  { code: "uk", label: "Ukrainian" },
  { code: "tr", label: "Turkish" },
  { code: "hi", label: "Hindi" },
  { code: "ta", label: "Tamil" },
  { code: "id", label: "Indonesian" },
  { code: "th", label: "Thai" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese (Mandarin)" },
];

export function languageLabel(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

export type ProviderOption = {
  id: string;
  label: string;
  role: Role;
  /** Environment variable the agent worker needs for this provider. */
  envKey: string;
  defaultModel: string;
  /** Model suggestions; any model name the provider accepts can be typed. */
  models: string[];
  /** TTS only: the default voice, and where to find others. */
  defaultVoice?: string;
  voiceHint?: string;
  /** False when the provider only handles English. */
  multilingual: boolean;
  /** False for speech-to-text that transcribes whole utterances (slower); never used as a fallback. */
  streaming?: boolean;
};

export const PROVIDERS: ProviderOption[] = [
  { id: "deepgram", role: "stt", label: "Deepgram", envKey: "DEEPGRAM_API_KEY", defaultModel: "nova-3", models: ["nova-3", "nova-2"], multilingual: true },
  { id: "assemblyai", role: "stt", label: "AssemblyAI", envKey: "ASSEMBLYAI_API_KEY", defaultModel: "universal-3-6-pro", models: ["universal-3-6-pro", "universal-streaming-multilingual", "universal-streaming-english"], multilingual: true },
  { id: "openai", role: "stt", label: "OpenAI", envKey: "OPENAI_API_KEY", defaultModel: "gpt-4o-mini-transcribe", models: ["gpt-4o-mini-transcribe", "gpt-4o-transcribe"], multilingual: true, streaming: false },

  { id: "openai", role: "llm", label: "OpenAI", envKey: "OPENAI_API_KEY", defaultModel: "gpt-4.1-mini", models: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini"], multilingual: true },
  { id: "anthropic", role: "llm", label: "Anthropic (Claude)", envKey: "ANTHROPIC_API_KEY", defaultModel: "claude-haiku-4-5", models: ["claude-haiku-4-5", "claude-sonnet-5-5", "claude-sonnet-4-6"], multilingual: true },
  { id: "google", role: "llm", label: "Google (Gemini)", envKey: "GOOGLE_API_KEY", defaultModel: "gemini-2.5-flash", models: ["gemini-2.5-flash", "gemini-2.5-flash-lite"], multilingual: true },
  { id: "groq", role: "llm", label: "Groq", envKey: "GROQ_API_KEY", defaultModel: "llama-3.3-70b-versatile", models: ["llama-3.3-70b-versatile"], multilingual: true },
  { id: "custom", role: "llm", label: "Custom (OpenAI-compatible)", envKey: "FALLBACK_LLM_API_KEY", defaultModel: "", models: [], multilingual: true },

  { id: "cartesia", role: "tts", label: "Cartesia", envKey: "CARTESIA_API_KEY", defaultModel: "sonic-3", models: ["sonic-3", "sonic-2", "sonic-turbo"], defaultVoice: "f786b574-daa5-4673-aa0c-cbe3e8534c02", voiceHint: "Voice ID from play.cartesia.ai", multilingual: true },
  { id: "elevenlabs", role: "tts", label: "ElevenLabs", envKey: "ELEVEN_API_KEY", defaultModel: "eleven_flash_v2_5", models: ["eleven_flash_v2_5", "eleven_turbo_v2_5", "eleven_multilingual_v2"], defaultVoice: "hpp4J3VqNfWAUOO0d1Us", voiceHint: "Voice ID from the ElevenLabs voice library", multilingual: true },
  { id: "openai", role: "tts", label: "OpenAI", envKey: "OPENAI_API_KEY", defaultModel: "gpt-4o-mini-tts", models: ["gpt-4o-mini-tts"], defaultVoice: "ash", voiceHint: "alloy, ash, ballad, coral, echo, sage, shimmer, verse", multilingual: true },
  { id: "deepgram", role: "tts", label: "Deepgram Aura", envKey: "DEEPGRAM_API_KEY", defaultModel: "aura-2-andromeda-en", models: ["aura-2-andromeda-en", "aura-2-thalia-en", "aura-2-apollo-en"], defaultVoice: "", voiceHint: "The voice is part of the model name", multilingual: false },
];

export function providersFor(role: Role): ProviderOption[] {
  return PROVIDERS.filter((p) => p.role === role);
}

export function findProvider(role: Role, id: string): ProviderOption | undefined {
  return PROVIDERS.find((p) => p.role === role && p.id === id);
}

export type ProviderChoice = { provider: string; model: string; voice?: string };

export type AgentProviders = { stt: ProviderChoice; llm: ProviderChoice; tts: ProviderChoice };

/** Agents created before provider selection used Deepgram + OpenAI + Cartesia. */
export function resolveProviders(
  stored: Partial<AgentProviders> | null | undefined,
  legacy: { llm_model: string; voice_id: string },
): AgentProviders {
  return {
    stt: stored?.stt ?? { provider: "deepgram", model: "nova-3" },
    llm: stored?.llm ?? { provider: "openai", model: legacy.llm_model || "gpt-4.1-mini" },
    tts: stored?.tts ?? { provider: "cartesia", model: "sonic-3", voice: legacy.voice_id },
  };
}

/** Primary provider first, then every other provider with an API key, as automatic fallbacks. */
export function providerChain(role: Role, primary: ProviderChoice, available: string[], language: string): ProviderChoice[] {
  const english = language.startsWith("en");
  const usable = (id: string) => {
    const p = findProvider(role, id);
    return p && available.includes(id) && (english || p.multilingual);
  };
  const chain: ProviderChoice[] = [];
  if (usable(primary.provider) || !available.length) chain.push(primary);
  for (const p of PROVIDERS) {
    if (p.role !== role || p.id === primary.provider || !usable(p.id)) continue;
    if (p.id === "custom") continue; // the custom LLM is configured by env and appended by the worker
    if (p.streaming === false) continue; // too slow to switch to mid-call
    chain.push({ provider: p.id, model: p.defaultModel, ...(role === "tts" ? { voice: p.defaultVoice ?? "" } : {}) });
  }
  // If the chosen provider has no key, the first available one leads.
  return chain.length ? chain : [primary];
}


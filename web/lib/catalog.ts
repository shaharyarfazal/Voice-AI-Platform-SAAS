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

/** An entry in a dropdown: the value saved, what people see, and a short note. */
export type Choice = { value: string; label: string; hint?: string; group?: string; previewUrl?: string };

export type ProviderOption = {
  id: string;
  label: string;
  role: Role;
  /** Environment variable the agent worker needs for this provider. */
  envKey: string;
  defaultModel: string;
  /** Recommended models, best default first. The provider's full list is added when its API is reachable. */
  models: Choice[];
  /** TTS only: the default voice, and voices to offer when the provider's voice list can't be loaded. */
  defaultVoice?: string;
  voices?: Choice[];
  /** False when the provider only handles English. */
  multilingual: boolean;
  /** False for speech-to-text that transcribes whole utterances (slower); never used as a fallback. */
  streaming?: boolean;
};

const OPENAI_VOICES: Choice[] = [
  { value: "marin", label: "Marin", hint: "Natural, warm. Recommended" },
  { value: "cedar", label: "Cedar", hint: "Natural, calm. Recommended" },
  { value: "ash", label: "Ash", hint: "Clear, confident" },
  { value: "coral", label: "Coral", hint: "Friendly, bright" },
  { value: "sage", label: "Sage", hint: "Calm, measured" },
  { value: "ballad", label: "Ballad", hint: "Soft, expressive" },
  { value: "verse", label: "Verse", hint: "Lively" },
  { value: "alloy", label: "Alloy", hint: "Neutral" },
  { value: "echo", label: "Echo", hint: "Deep" },
  { value: "shimmer", label: "Shimmer", hint: "Light" },
];

export const PROVIDERS: ProviderOption[] = [
  {
    id: "deepgram", role: "stt", label: "Deepgram", envKey: "DEEPGRAM_API_KEY", defaultModel: "nova-3", multilingual: true,
    models: [
      { value: "nova-3", label: "Nova-3", hint: "Most accurate, multilingual. Recommended" },
      { value: "nova-2", label: "Nova-2", hint: "Previous generation" },
    ],
  },
  {
    id: "assemblyai", role: "stt", label: "AssemblyAI", envKey: "ASSEMBLYAI_API_KEY", defaultModel: "universal-3-6-pro", multilingual: true,
    models: [
      { value: "universal-3-6-pro", label: "Universal-3 Pro", hint: "Best in noise; isolates the caller's voice in noisy mode" },
      { value: "universal-streaming-multilingual", label: "Universal Streaming Multilingual", hint: "6 languages" },
      { value: "universal-streaming-english", label: "Universal Streaming English", hint: "English only, lowest cost" },
    ],
  },
  {
    id: "elevenlabs", role: "stt", label: "ElevenLabs Scribe", envKey: "ELEVEN_API_KEY", defaultModel: "scribe_v2_realtime", multilingual: true,
    models: [{ value: "scribe_v2_realtime", label: "Scribe v2 Realtime", hint: "Streaming, 90+ languages" }],
  },
  {
    id: "openai", role: "stt", label: "OpenAI", envKey: "OPENAI_API_KEY", defaultModel: "gpt-4o-mini-transcribe", multilingual: true, streaming: false,
    models: [
      { value: "gpt-4o-mini-transcribe", label: "GPT-4o mini Transcribe", hint: "Waits for the caller to finish" },
      { value: "gpt-4o-transcribe", label: "GPT-4o Transcribe", hint: "More accurate, slower" },
    ],
  },

  {
    id: "openai", role: "llm", label: "OpenAI", envKey: "OPENAI_API_KEY", defaultModel: "gpt-4.1-mini", multilingual: true,
    models: [
      { value: "gpt-4.1-mini", label: "GPT-4.1 mini", hint: "Fast, follows instructions well. Recommended" },
      { value: "gpt-4.1", label: "GPT-4.1", hint: "Smarter, a little slower" },
      { value: "gpt-5.4-mini", label: "GPT-5.4 mini", hint: "Newer, minimal reasoning" },
      { value: "gpt-5.4-nano", label: "GPT-5.4 nano", hint: "Cheapest" },
      { value: "gpt-4o-mini", label: "GPT-4o mini", hint: "Older, low cost" },
    ],
  },
  {
    id: "anthropic", role: "llm", label: "Anthropic Claude", envKey: "ANTHROPIC_API_KEY", defaultModel: "claude-haiku-4-5", multilingual: true,
    models: [
      { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", hint: "Fastest Claude. Recommended for calls" },
      { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", hint: "Smarter, slower first word" },
      { value: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", hint: "Newest Sonnet; thinks before answering, slowest" },
    ],
  },
  {
    id: "google", role: "llm", label: "Google Gemini", envKey: "GOOGLE_API_KEY", defaultModel: "gemini-2.5-flash", multilingual: true,
    models: [
      { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "Fast, reliable. Recommended" },
      { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", hint: "Cheapest, fastest" },
      { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash", hint: "Newer generation" },
      { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", hint: "Newer, low cost" },
      { value: "gemini-3.7-flash", label: "Gemini 3.7 Flash", hint: "Newest Flash, smartest" },
    ],
  },
  {
    id: "groq", role: "llm", label: "Groq", envKey: "GROQ_API_KEY", defaultModel: "llama-3.3-70b-versatile", multilingual: true,
    models: [
      { value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", hint: "Very fast" },
      { value: "openai/gpt-oss-120b", label: "GPT-OSS 120B", hint: "Open model, fast" },
    ],
  },
  { id: "custom", role: "llm", label: "Custom (OpenAI-compatible)", envKey: "FALLBACK_LLM_API_KEY", defaultModel: "", models: [], multilingual: true },

  {
    id: "cartesia", role: "tts", label: "Cartesia", envKey: "CARTESIA_API_KEY", defaultModel: "sonic-3", multilingual: true,
    defaultVoice: "f786b574-daa5-4673-aa0c-cbe3e8534c02",
    models: [
      { value: "sonic-3", label: "Sonic 3", hint: "Most natural, 40+ languages. Recommended" },
      { value: "sonic-turbo", label: "Sonic Turbo", hint: "Lowest latency" },
      { value: "sonic-2", label: "Sonic 2", hint: "Previous generation" },
    ],
    voices: [{ value: "f786b574-daa5-4673-aa0c-cbe3e8534c02", label: "Default voice" }],
  },
  {
    id: "elevenlabs", role: "tts", label: "ElevenLabs", envKey: "ELEVEN_API_KEY", defaultModel: "eleven_flash_v2_5", multilingual: true,
    defaultVoice: "hpp4J3VqNfWAUOO0d1Us",
    models: [
      { value: "eleven_flash_v2_5", label: "Flash v2.5", hint: "Fastest, 32 languages. Recommended" },
      { value: "eleven_turbo_v2_5", label: "Turbo v2.5", hint: "Higher quality, a little slower" },
      { value: "eleven_multilingual_v2", label: "Multilingual v2", hint: "Most expressive, slowest" },
    ],
    voices: [{ value: "hpp4J3VqNfWAUOO0d1Us", label: "Default voice" }],
  },
  {
    id: "openai", role: "tts", label: "OpenAI", envKey: "OPENAI_API_KEY", defaultModel: "gpt-4o-mini-tts", multilingual: true,
    defaultVoice: "marin",
    models: [{ value: "gpt-4o-mini-tts", label: "GPT-4o mini TTS", hint: "Steerable tone" }],
    voices: OPENAI_VOICES,
  },
  {
    id: "deepgram", role: "tts", label: "Deepgram Aura", envKey: "DEEPGRAM_API_KEY", defaultModel: "aura-2-thalia-en", multilingual: false,
    defaultVoice: "",
    // Aura's voice is part of the model name, so the model list is the voice list.
    models: [
      { value: "aura-2-thalia-en", label: "Thalia", hint: "English (US), female, clear" },
      { value: "aura-2-andromeda-en", label: "Andromeda", hint: "English (US), female, casual" },
      { value: "aura-2-helena-en", label: "Helena", hint: "English (US), female, friendly" },
      { value: "aura-2-apollo-en", label: "Apollo", hint: "English (US), male, confident" },
      { value: "aura-2-arcas-en", label: "Arcas", hint: "English (US), male, natural" },
      { value: "aura-2-orion-en", label: "Orion", hint: "English (US), male, calm" },
    ],
  },
];

/** OpenAI Realtime: one speech-to-speech model hears the caller and answers in its own voice. */
export const REALTIME = {
  envKey: "OPENAI_API_KEY",
  defaultModel: "gpt-realtime",
  defaultVoice: "marin",
  models: [
    { value: "gpt-realtime", label: "GPT Realtime", hint: "Recommended" },
    { value: "gpt-realtime-2", label: "GPT Realtime 2", hint: "Newest; reasons before answering" },
    { value: "gpt-realtime-1.5", label: "GPT Realtime 1.5" },
  ] as Choice[],
  voices: OPENAI_VOICES,
};


export function providersFor(role: Role): ProviderOption[] {
  return PROVIDERS.filter((p) => p.role === role);
}

export function findProvider(role: Role, id: string): ProviderOption | undefined {
  return PROVIDERS.find((p) => p.role === role && p.id === id);
}

export type ProviderChoice = { provider: string; model: string; voice?: string };

export type RealtimeChoice = { model: string; voice: string };

export type AgentProviders = {
  /** "pipeline": speech-to-text → LLM → voice. "realtime": OpenAI Realtime does all three. */
  mode: "pipeline" | "realtime";
  stt: ProviderChoice;
  llm: ProviderChoice;
  tts: ProviderChoice;
  realtime: RealtimeChoice;
};

/** Agents created before provider selection used Deepgram + OpenAI + Cartesia. */
export function resolveProviders(
  stored: Partial<AgentProviders> | null | undefined,
  legacy: { llm_model: string; voice_id: string },
): AgentProviders {
  return {
    mode: stored?.mode === "realtime" ? "realtime" : "pipeline",
    realtime: stored?.realtime ?? { model: REALTIME.defaultModel, voice: REALTIME.defaultVoice },
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


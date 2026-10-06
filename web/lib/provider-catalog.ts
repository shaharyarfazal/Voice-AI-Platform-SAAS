import "server-only";
import { PROVIDERS, REALTIME, type Choice, type Role } from "./catalog";

// Live model and voice lists from each provider's API, so the agent editor offers what the
// platform's accounts can actually use. Each list falls back to the curated one in catalog.ts
// when the provider has no key on the web app or its API can't be reached.

const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; value: Choice[] | null }>();

async function cached(key: string, load: () => Promise<Choice[] | null>): Promise<Choice[] | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: Choice[] | null = null;
  try {
    value = await load();
  } catch {
    value = null;
  }
  // Remember failures for a minute only, so a fixed key shows up quickly.
  cache.set(key, { at: value ? Date.now() : Date.now() - TTL_MS + 60_000, value });
  return value;
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

const env = (k: string) => process.env[k] || "";
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

// ---- Voices ----

type ElevenVoice = { voice_id: string; name: string; category?: string; preview_url?: string; labels?: Record<string, string> };

async function elevenLabsVoices(): Promise<Choice[] | null> {
  if (!env("ELEVEN_API_KEY")) return null;
  const body = (await getJson("https://api.elevenlabs.io/v1/voices", { "xi-api-key": env("ELEVEN_API_KEY") })) as { voices?: ElevenVoice[] };
  return (body.voices ?? [])
    .map((v) => {
      const l = v.labels ?? {};
      const hint = [l.gender, l.age, l.accent, l.description ?? l.descriptive, l.use_case].filter(Boolean).map((x) => x.replaceAll("_", " ")).join(", ");
      return {
        value: v.voice_id,
        label: v.name,
        hint: hint || undefined,
        group: v.category === "premade" ? "ElevenLabs voices" : "Your voices",
        previewUrl: v.preview_url || undefined,
      };
    })
    .sort((a, b) => (a.group === b.group ? a.label.localeCompare(b.label) : a.group === "Your voices" ? -1 : 1));
}

type CartesiaVoice = { id: string; name: string; description?: string; language?: string };

async function cartesiaVoices(): Promise<Choice[] | null> {
  if (!env("CARTESIA_API_KEY")) return null;
  const headers = { "X-API-Key": env("CARTESIA_API_KEY"), "Cartesia-Version": "2025-04-16" };
  const voices: CartesiaVoice[] = [];
  let after = "";
  for (let page = 0; page < 10; page++) {
    const body = (await getJson(`https://api.cartesia.ai/voices?limit=100${after ? `&starting_after=${after}` : ""}`, headers)) as
      | CartesiaVoice[]
      | { data?: CartesiaVoice[]; has_more?: boolean };
    const batch = Array.isArray(body) ? body : (body.data ?? []);
    voices.push(...batch);
    if (Array.isArray(body) || !body.has_more || batch.length === 0) break;
    after = batch[batch.length - 1].id;
  }
  const languages = new Intl.DisplayNames(["en"], { type: "language" });
  const languageName = (code?: string) => {
    if (!code) return "Other";
    try {
      return languages.of(code) ?? code;
    } catch {
      return code;
    }
  };
  return voices
    .map((v) => ({ value: v.id, label: v.name, hint: v.description?.slice(0, 120) || undefined, group: languageName(v.language) }))
    .sort((a, b) => (a.group === b.group ? a.label.localeCompare(b.label) : a.group === "English" ? -1 : b.group === "English" ? 1 : a.group.localeCompare(b.group)));
}

type DeepgramModels = { tts?: { canonical_name: string; name: string; languages?: string[]; metadata?: { accent?: string; tags?: string[] } }[] };

async function deepgramVoices(): Promise<Choice[] | null> {
  if (!env("DEEPGRAM_API_KEY")) return null;
  const body = (await getJson("https://api.deepgram.com/v1/models", { Authorization: `Token ${env("DEEPGRAM_API_KEY")}` })) as DeepgramModels;
  return (body.tts ?? [])
    .filter((m) => m.canonical_name.startsWith("aura-2"))
    .map((m) => ({
      value: m.canonical_name,
      label: titleCase(m.name),
      hint: [m.metadata?.accent, ...(m.metadata?.tags ?? []).slice(0, 3)].filter(Boolean).join(", ") || undefined,
      group: m.languages?.[0] ?? "Other",
    }))
    .sort((a, b) => (a.group === b.group ? a.label.localeCompare(b.label) : a.group.localeCompare(b.group)));
}

// ---- Models ----

/** OpenAI chat models worth offering for calls: current GPT families, no dated snapshots or special-purpose models. */
const OPENAI_SKIP = /(audio|realtime|transcribe|tts|image|search|embedding|moderation|instruct|codex|computer|deep-research|-\d{4}-\d{2}-\d{2}$|-preview)/;

async function openaiModelIds(): Promise<string[] | null> {
  if (!env("OPENAI_API_KEY")) return null;
  const body = (await getJson("https://api.openai.com/v1/models", { Authorization: `Bearer ${env("OPENAI_API_KEY")}` })) as { data?: { id: string }[] };
  return (body.data ?? []).map((m) => m.id);
}

async function openaiChatModels(): Promise<Choice[] | null> {
  const ids = await openaiModelIds();
  return ids
    ?.filter((id) => /^(gpt-[45]|gpt-6|o\d)/.test(id) && !OPENAI_SKIP.test(id))
    .sort()
    .reverse()
    .map((id) => ({ value: id, label: id })) ?? null;
}

async function openaiRealtimeModels(): Promise<Choice[] | null> {
  const ids = await openaiModelIds();
  return ids?.filter((id) => id.includes("realtime") && !/-\d{4}-\d{2}-\d{2}$/.test(id)).sort().map((id) => ({ value: id, label: id })) ?? null;
}

async function anthropicModels(): Promise<Choice[] | null> {
  if (!env("ANTHROPIC_API_KEY")) return null;
  const body = (await getJson("https://api.anthropic.com/v1/models?limit=100", {
    "x-api-key": env("ANTHROPIC_API_KEY"),
    "anthropic-version": "2023-06-01",
  })) as { data?: { id: string; display_name?: string }[] };
  return (body.data ?? []).map((m) => ({ value: m.id, label: m.display_name || m.id }));
}

async function googleModels(): Promise<Choice[] | null> {
  if (!env("GOOGLE_API_KEY")) return null;
  const body = (await getJson(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(env("GOOGLE_API_KEY"))}`, {})) as {
    models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
  };
  return (body.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => ({ value: m.name.replace(/^models\//, ""), label: m.displayName || m.name }))
    .filter((m) => m.value.startsWith("gemini-") && !/(image|tts|embedding|live|audio|vision|exp|computer|robotics)/.test(m.value));
}

async function groqModels(): Promise<Choice[] | null> {
  if (!env("GROQ_API_KEY")) return null;
  const body = (await getJson("https://api.groq.com/openai/v1/models", { Authorization: `Bearer ${env("GROQ_API_KEY")}` })) as { data?: { id: string; active?: boolean }[] };
  return (body.data ?? [])
    .filter((m) => m.active !== false && !/(whisper|tts|guard|orpheus|playai|compound)/.test(m.id))
    .map((m) => ({ value: m.id, label: m.id }));
}

/**
 * Curated models first (with their notes), keeping only those the provider still lists when its
 * list is known, then the rest of the provider's models under "More models".
 */
export function mergeModels(curated: Choice[], live: Choice[] | null): Choice[] {
  if (!live || live.length === 0) return curated;
  const liveIds = new Set(live.map((m) => m.value));
  const kept = curated.filter((m) => liveIds.has(m.value)).map((m) => ({ ...m, group: "Recommended for calls" }));
  const keptIds = new Set(kept.map((m) => m.value));
  return [...kept, ...live.filter((m) => !keptIds.has(m.value)).map((m) => ({ ...m, group: "More models" }))];
}

export type ProviderCatalog = {
  /** Models per role and provider id. */
  models: Record<Role, Record<string, Choice[]>>;
  /** Voices per TTS provider id (Deepgram's voices are its models). */
  voices: Record<string, Choice[]>;
  realtime: { models: Choice[]; voices: Choice[] };
};

export async function loadProviderCatalog(): Promise<ProviderCatalog> {
  const [eleven, cartesia, deepgram, openai, realtime, anthropic, google, groq] = await Promise.all([
    cached("voices:elevenlabs", elevenLabsVoices),
    cached("voices:cartesia", cartesiaVoices),
    cached("voices:deepgram", deepgramVoices),
    cached("models:openai", openaiChatModels),
    cached("models:realtime", openaiRealtimeModels),
    cached("models:anthropic", anthropicModels),
    cached("models:google", googleModels),
    cached("models:groq", groqModels),
  ]);
  const liveLlm: Record<string, Choice[] | null> = { openai, anthropic, google, groq };

  const models: ProviderCatalog["models"] = { stt: {}, llm: {}, tts: {} };
  const voices: ProviderCatalog["voices"] = {};
  for (const p of PROVIDERS) {
    if (p.role === "llm") models.llm[p.id] = mergeModels(p.models, liveLlm[p.id] ?? null);
    else if (p.role === "tts" && p.id === "deepgram") models.tts[p.id] = deepgram?.length ? deepgram : p.models;
    else models[p.role][p.id] = p.models;
    if (p.role === "tts") {
      const live = { elevenlabs: eleven, cartesia }[p.id as "elevenlabs" | "cartesia"];
      voices[p.id] = live?.length ? live : (p.voices ?? []);
    }
  }
  return { models, voices, realtime: { models: mergeModels(REALTIME.models, realtime), voices: REALTIME.voices } };
}

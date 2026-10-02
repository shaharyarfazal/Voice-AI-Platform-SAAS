import "server-only";
import { sql } from "./db";

export type ProviderRates = {
  /** USD per minute of speech-to-text audio (Deepgram). */
  sttPerMinute: number;
  /** USD per million LLM input tokens (OpenAI). */
  llmInputPerMillion: number;
  /** USD per million LLM output tokens (OpenAI). */
  llmOutputPerMillion: number;
  /** USD per thousand text-to-speech characters (Cartesia). */
  ttsPerThousandChars: number;
  /** USD per minute of phone-call time (Telnyx/Twilio inbound + number share). */
  telephonyPerMinute: number;
  /** USD per month for servers (Contabo etc.). */
  serverMonthly: number;
};

export type PlatformSettings = {
  allowSignup: boolean;
  /** Spoken before every greeting when the agent's "announce AI" option is on. */
  disclosure: string;
  /** Appended to every agent's instructions. */
  safetyInstructions: string;
  /** Spoken when a provider fails mid-call, before hanging up. */
  apologyMessage: string;
  termsUrl: string;
  privacyUrl: string;
  rates: ProviderRates;
};

// Provider prices change, so rates start at zero: enter your current prices in Admin > Settings.
export const DEFAULT_SETTINGS: PlatformSettings = {
  allowSignup: process.env.ALLOW_SIGNUP !== "false",
  disclosure: "This call is answered by an AI assistant and may be transcribed.",
  safetyInstructions:
    "If the caller describes an emergency, such as a medical problem, a fire, a crime in progress or any danger to someone's life, " +
    "tell them to hang up and call their local emergency number (911 in the US, 112 in Europe) right away. " +
    "Never take card numbers or passwords over the phone.",
  apologyMessage: "I'm sorry, we're having technical difficulties right now. Please call back in a few minutes. Goodbye.",
  termsUrl: "",
  privacyUrl: "",
  rates: {
    sttPerMinute: 0,
    llmInputPerMillion: 0,
    llmOutputPerMillion: 0,
    ttsPerThousandChars: 0,
    telephonyPerMinute: 0,
    serverMonthly: 0,
  },
};

export async function getSettings(): Promise<PlatformSettings> {
  const rows = await sql<{ value: Partial<PlatformSettings> }[]>`SELECT value FROM platform_settings WHERE key = 'platform'`;
  const stored = rows[0]?.value ?? {};
  return { ...DEFAULT_SETTINGS, ...stored, rates: { ...DEFAULT_SETTINGS.rates, ...(stored.rates ?? {}) } };
}

export async function saveSettings(settings: PlatformSettings): Promise<void> {
  await sql`
    INSERT INTO platform_settings (key, value) VALUES ('platform', ${sql.json(settings)})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

/** SQL expression for a call's estimated provider cost in USD, given the current rates. */
export function callCostSql(rates: ProviderRates) {
  return sql`(
    c.stt_seconds / 60.0 * ${rates.sttPerMinute}
    + c.llm_input_tokens / 1000000.0 * ${rates.llmInputPerMillion}
    + c.llm_output_tokens / 1000000.0 * ${rates.llmOutputPerMillion}
    + c.tts_characters / 1000.0 * ${rates.ttsPerThousandChars}
    + CASE WHEN c.channel = 'phone' THEN c.duration_seconds / 60.0 * ${rates.telephonyPerMinute} ELSE 0 END
  )`;
}

export function ratesConfigured(rates: ProviderRates): boolean {
  return Object.values(rates).some((v) => v > 0);
}

import "server-only";

export type ElevenLabsVoice = { id: string; name: string; category: string };

let cache: { at: number; voices: ElevenLabsVoice[] } | null = null;

/**
 * Voices in the platform's ElevenLabs account ("My Voices": premade, cloned and library voices
 * that were added). A voice ID from the public library that wasn't added fails mid-call with
 * voice_id_does_not_exist. Null when the web app has no ElevenLabs key or the API is unreachable.
 */
export async function listElevenLabsVoices(): Promise<ElevenLabsVoice[] | null> {
  const key = process.env.ELEVEN_API_KEY;
  if (!key) return null;
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.voices;
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": key },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { voices?: { voice_id: string; name: string; category?: string }[] };
    const voices = (body.voices ?? [])
      .map((v) => ({ id: v.voice_id, name: v.name, category: v.category ?? "" }))
      .sort((a, b) => a.name.localeCompare(b.name));
    cache = { at: Date.now(), voices };
    return voices;
  } catch {
    return null;
  }
}

/** False only when ElevenLabs says the voice doesn't exist for this account; true if unsure. */
export async function elevenLabsVoiceExists(voiceId: string): Promise<boolean> {
  const key = process.env.ELEVEN_API_KEY;
  if (!key) return true;
  const voices = await listElevenLabsVoices();
  if (voices?.some((v) => v.id === voiceId)) return true;
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voiceId)}`, {
      headers: { "xi-api-key": key },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok || (res.status !== 400 && res.status !== 404);
  } catch {
    return true;
  }
}

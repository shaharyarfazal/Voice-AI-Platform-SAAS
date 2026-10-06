import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { stat, unlink } from "node:fs/promises";
import path from "node:path";
import { publicUrl } from "./oauth";

// Call recordings are MP3 files (Ogg/Opus for calls recorded before MP3 support) uploaded by the
// agent worker and stored on the web server's disk.
export const RECORDINGS_DIR = process.env.RECORDINGS_DIR || path.join(process.cwd(), "recordings");
/** How long a recording link in a webhook stays valid. */
export const RECORDING_LINK_DAYS = 7;

export const FORMATS = { mp3: "audio/mpeg", ogg: "audio/ogg" } as const;
export type RecordingFormat = keyof typeof FORMATS;

export function recordingPath(callId: string, format: RecordingFormat): string {
  return path.join(RECORDINGS_DIR, `${callId}.${format}`);
}

/** The stored recording, if any: MP3 first, then the older Ogg format. */
export async function findRecording(callId: string): Promise<{ path: string; format: RecordingFormat; size: number } | null> {
  for (const format of Object.keys(FORMATS) as RecordingFormat[]) {
    const file = recordingPath(callId, format);
    try {
      const { size } = await stat(file);
      if (size > 0) return { path: file, format, size };
    } catch {
      // try the next format
    }
  }
  return null;
}

export async function recordingExists(callId: string): Promise<boolean> {
  return (await findRecording(callId)) !== null;
}

export async function deleteRecording(callId: string): Promise<void> {
  for (const format of Object.keys(FORMATS) as RecordingFormat[]) await unlink(recordingPath(callId, format)).catch(() => {});
}

function signature(callId: string, expires: number): string {
  return createHmac("sha256", process.env.SESSION_SECRET!).update(`recording:${callId}:${expires}`).digest("hex");
}

/** A download link that works without signing in, until it expires. */
export function signedRecordingUrl(callId: string): { url: string; expiresAt: string } {
  const expires = Math.floor(Date.now() / 1000) + RECORDING_LINK_DAYS * 86400;
  const url = publicUrl(`/api/recordings/${callId}?expires=${expires}&signature=${signature(callId, expires)}`).toString();
  return { url, expiresAt: new Date(expires * 1000).toISOString() };
}

export function verifyRecordingSignature(callId: string, expires: string | null, sig: string | null): boolean {
  const exp = Number(expires);
  if (!sig || !Number.isInteger(exp) || exp < Date.now() / 1000) return false;
  const expected = Buffer.from(signature(callId, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

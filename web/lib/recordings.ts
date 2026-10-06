import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { stat, unlink } from "node:fs/promises";
import path from "node:path";
import { publicUrl } from "./oauth";

// Call recordings are Ogg/Opus files written by the agent worker and stored on the web server's disk.
export const RECORDINGS_DIR = process.env.RECORDINGS_DIR || path.join(process.cwd(), "recordings");
/** How long a recording link in a webhook stays valid. */
export const RECORDING_LINK_DAYS = 7;

export function recordingPath(callId: string): string {
  return path.join(RECORDINGS_DIR, `${callId}.ogg`);
}

export async function recordingExists(callId: string): Promise<boolean> {
  try {
    return (await stat(recordingPath(callId))).size > 0;
  } catch {
    return false;
  }
}

export async function deleteRecording(callId: string): Promise<void> {
  await unlink(recordingPath(callId)).catch(() => {});
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

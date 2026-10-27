import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { stat, unlink } from "node:fs/promises";
import path from "node:path";
import { publicUrl } from "./oauth";
import { presign, s3Config } from "./s3";

// Call recordings are MP3 files (Ogg/Opus for calls recorded before MP3 support) uploaded by the
// agent worker. With S3_* set they live in object storage: the agent uploads straight to a presigned
// URL and players are redirected to a presigned download, which is what serverless hosting (Vercel)
// needs. Otherwise they are stored on the web server's disk, as on a single VPS.
export const RECORDINGS_DIR = process.env.RECORDINGS_DIR || path.join(process.cwd(), "recordings");
/** How long a recording link in a webhook stays valid. */
export const RECORDING_LINK_DAYS = 7;

export const FORMATS = { mp3: "audio/mpeg", ogg: "audio/ogg" } as const;
export type RecordingFormat = keyof typeof FORMATS;

export type StoredRecording = { format: RecordingFormat; size: number; path?: string };

export function recordingPath(callId: string, format: RecordingFormat): string {
  return path.join(RECORDINGS_DIR, `${callId}.${format}`);
}

const objectKey = (callId: string, format: RecordingFormat) => `recordings/${callId}.${format}`;

export function usesObjectStorage(): boolean {
  return s3Config() !== null;
}

/** The stored recording, if any: MP3 first, then the older Ogg format. */
export async function findRecording(callId: string): Promise<StoredRecording | null> {
  const s3 = s3Config();
  for (const format of Object.keys(FORMATS) as RecordingFormat[]) {
    if (s3) {
      const res = await fetch(presign(s3, "HEAD", objectKey(callId, format), { expiresSeconds: 60 }), { method: "HEAD" }).catch(() => null);
      const size = Number(res?.headers.get("content-length") ?? 0);
      if (res?.ok && size > 0) return { format, size };
      continue;
    }
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
  const s3 = s3Config();
  for (const format of Object.keys(FORMATS) as RecordingFormat[]) {
    if (s3) await fetch(presign(s3, "DELETE", objectKey(callId, format), { expiresSeconds: 60 }), { method: "DELETE" }).catch(() => {});
    else await unlink(recordingPath(callId, format)).catch(() => {});
  }
}

/** Where the agent worker uploads a recording directly, or null to upload through the web app. */
export function recordingUploadUrl(callId: string, format: RecordingFormat): string | null {
  const s3 = s3Config();
  return s3 ? presign(s3, "PUT", objectKey(callId, format), { expiresSeconds: 900 }) : null;
}

/** A short-lived direct download link from object storage. */
export function recordingObjectUrl(callId: string, format: RecordingFormat, download: boolean): string | null {
  const s3 = s3Config();
  if (!s3) return null;
  return presign(s3, "GET", objectKey(callId, format), {
    expiresSeconds: 300,
    query: {
      "response-content-type": FORMATS[format],
      "response-content-disposition": `${download ? "attachment" : "inline"}; filename="call-${callId}.${format}"`,
    },
  });
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

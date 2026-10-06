import { createWriteStream } from "node:fs";
import { mkdir, rename, unlink } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isInternalRequest } from "@/lib/auth";
import { deleteRecording, RECORDINGS_DIR, recordingPath } from "@/lib/recordings";
import { isUuid } from "@/lib/validation";

const MAX_BYTES = 200 * 1024 * 1024; // about 7 hours of 64 kbps MP3

// The agent worker uploads the call recording (MP3, or Ogg if conversion failed) here before
// reporting the call's end.
export async function PUT(request: Request, { params }: RouteContext<"/api/internal/recordings/[id]">) {
  if (!isInternalRequest(request)) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!isUuid(id) || !request.body) return new Response("Bad request", { status: 400 });

  const format = request.headers.get("content-type")?.startsWith("audio/ogg") ? "ogg" : "mp3";
  await mkdir(RECORDINGS_DIR, { recursive: true });
  await deleteRecording(id); // a retried upload may arrive in the other format
  const final = recordingPath(id, format);
  const partial = `${final}.part`;
  let size = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _enc, done) {
      size += chunk.length;
      done(size > MAX_BYTES ? new Error("Recording too large") : null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(request.body as never), limit, createWriteStream(partial));
    await rename(partial, final);
  } catch (e) {
    await unlink(partial).catch(() => {});
    return new Response(e instanceof Error ? e.message : "Upload failed", { status: 400 });
  }
  return Response.json({ ok: true, bytes: size });
}

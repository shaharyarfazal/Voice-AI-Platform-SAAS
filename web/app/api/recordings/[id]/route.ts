import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { findRecording, FORMATS, verifyRecordingSignature } from "@/lib/recordings";
import { isUuid } from "@/lib/validation";

// Call recording download. Works with the signed link from a webhook (no sign-in), or for a
// signed-in user of the client that owns the call (the player on the call page).
export async function GET(request: Request, { params }: RouteContext<"/api/recordings/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) return new Response("Not found", { status: 404 });
  const { searchParams } = new URL(request.url);

  let allowed = verifyRecordingSignature(id, searchParams.get("expires"), searchParams.get("signature"));
  if (!allowed) {
    const session = await getSession();
    if (session) {
      const [own] = await sql`SELECT 1 FROM calls WHERE id = ${id} AND tenant_id = ${session.tenantId}`;
      allowed = Boolean(own);
    }
  }
  if (!allowed) return new Response("This recording link is invalid or has expired.", { status: 403 });

  const [call] = await sql<{ has_recording: boolean }[]>`SELECT has_recording FROM calls WHERE id = ${id}`;
  if (!call?.has_recording) return new Response("Not found", { status: 404 });
  const file = await findRecording(id);
  if (!file) return new Response("Not found", { status: 404 });
  const stream = Readable.toWeb(createReadStream(file.path)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "content-type": FORMATS[file.format],
      "content-length": String(file.size),
      "accept-ranges": "none",
      "content-disposition": `${searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="call-${id}.${file.format}"`,
      "cache-control": "private, no-store",
    },
  });
}

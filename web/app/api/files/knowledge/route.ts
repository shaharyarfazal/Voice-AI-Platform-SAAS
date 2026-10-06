import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { addSource, fileToText, MAX_FILE_BYTES } from "@/lib/knowledge/ingest";
import { isUuid } from "@/lib/validation";

// Document upload for the knowledge base (outside the proxy, so large files aren't truncated).
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_FILE_BYTES * 5) {
    return Response.json({ error: "Upload up to 5 files of 25 MB at a time." }, { status: 413 });
  }
  const form = await request.formData();
  const kbId = form.get("kbId")?.toString();
  if (!isUuid(kbId)) return Response.json({ error: "Missing knowledge base" }, { status: 400 });
  const [kb] = await sql`SELECT 1 FROM knowledge_bases WHERE id = ${kbId} AND tenant_id = ${session.tenantId}`;
  if (!kb) return Response.json({ error: "Knowledge base not found" }, { status: 404 });

  const results: { name: string; ok: boolean; error?: string }[] = [];
  for (const entry of form.getAll("files").slice(0, 10)) {
    if (!(entry instanceof File)) continue;
    try {
      const text = await fileToText(entry.name, new Uint8Array(await entry.arrayBuffer()));
      await addSource(session.tenantId, kbId, { kind: "file", title: entry.name, content: text });
      results.push({ name: entry.name, ok: true });
    } catch (e) {
      results.push({ name: entry.name, ok: false, error: e instanceof Error ? e.message : "Couldn't read the file" });
    }
  }
  return Response.json({ results });
}

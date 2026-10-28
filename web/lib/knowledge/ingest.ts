import "server-only";
import { after } from "next/server";
import { sql } from "../db";
import { fetchPublic } from "../net";
import { chunkText } from "./chunk";
import { crawlWebsite } from "./crawl";
import { embed } from "./embed";
import { FILE_TYPES, htmlToPage, pdfToText } from "./extract";

// Knowledge sources are processed in the background, two at a time, by this web process.
// A source moves queued -> processing -> ready (or error); re-syncing puts it back in the queue.

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_CHARS = 2_000_000;
const MAX_CHUNKS = 4000;

export async function addSource(
  tenantId: string,
  kbId: string,
  s: { kind: "website" | "url" | "text" | "file"; title: string; url?: string; content?: string; maxPages?: number },
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO kb_sources (kb_id, tenant_id, kind, title, url, content, options)
    VALUES (${kbId}, ${tenantId}, ${s.kind}, ${s.title.slice(0, 300)}, ${s.url ?? null}, ${s.content?.slice(0, MAX_CHARS) ?? null},
            ${sql.json({ maxPages: s.maxPages ?? 30 })})
    RETURNING id`;
  kick();
  return row.id;
}

/** Parses an uploaded document. Throws a readable error for unsupported or unreadable files. */
export async function fileToText(fileName: string, data: Uint8Array): Promise<string> {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const type = FILE_TYPES[ext];
  if (!type) throw new Error("Upload a PDF, Word (.docx), text, Markdown or CSV file.");
  if (data.length > MAX_FILE_BYTES) throw new Error("Files can be up to 25 MB.");
  const text = await type.parse(data);
  if (text.trim().length < 20) throw new Error("No readable text found. Scanned PDFs need to be converted to text first.");
  return text;
}

export async function resync(tenantId: string, sourceId: string): Promise<void> {
  await sql`UPDATE kb_sources SET status = 'queued', error = NULL, updated_at = now() WHERE id = ${sourceId} AND tenant_id = ${tenantId} AND status <> 'processing'`;
  kick();
}

type Doc = { title: string; url: string | null; text: string };

async function load(source: { kind: string; title: string; url: string | null; content: string | null; options: { maxPages?: number } }, id: string): Promise<Doc[]> {
  if (source.kind === "website") {
    const pages = await crawlWebsite(source.url!, Math.min(200, source.options.maxPages ?? 30), (done, total) => {
      void sql`UPDATE kb_sources SET pages = ${done}, updated_at = now() WHERE id = ${id}`.catch(() => {});
      void total;
    });
    if (pages.length === 0) throw new Error("No readable pages were found. Check the address, or the site may block automated reading.");
    return pages.map((p) => ({ title: p.title, url: p.url, text: p.text }));
  }
  if (source.kind === "url") {
    const res = await fetchPublic(source.url!, { maxBytes: 15_000_000 });
    if (!res) throw new Error("The page couldn't be loaded.");
    if (res.contentType.includes("pdf")) return [{ title: source.title, url: res.url, text: await pdfToText(res.body) }];
    const page = htmlToPage(new TextDecoder().decode(res.body), res.url);
    return [{ title: page.title, url: res.url, text: page.text }];
  }
  return [{ title: source.title, url: source.url, text: source.content ?? "" }];
}

async function processSource(id: string): Promise<void> {
  const [source] = await sql<{ kb_id: string; kind: string; title: string; url: string | null; content: string | null; options: { maxPages?: number } }[]>`
    SELECT kb_id, kind, title, url, content, options FROM kb_sources WHERE id = ${id}`;
  if (!source) return;
  try {
    const docs = await load(source, id);
    const pieces: { title: string; url: string | null; content: string }[] = [];
    let chars = 0;
    for (const d of docs) {
      chars += d.text.length;
      if (chars > MAX_CHARS) break;
      for (const c of chunkText(d.text)) pieces.push({ title: d.title, url: d.url, content: c });
    }
    const chunks = pieces.slice(0, MAX_CHUNKS);
    let vectors: number[][] | null = null;
    try {
      vectors = await embed(chunks.map((c) => `${c.title}\n${c.content}`));
    } catch (e) {
      console.error("knowledge: embeddings failed, keyword search only", e);
    }
    await sql.begin(async (tx) => {
      await tx`DELETE FROM kb_chunks WHERE source_id = ${id}`;
      for (let i = 0; i < chunks.length; i += 200) {
        const rows = chunks.slice(i, i + 200).map((c, j) => ({
          source_id: id,
          kb_id: source.kb_id,
          title: c.title,
          url: c.url,
          content: c.content,
          embedding: vectors ? vectors[i + j] : null,
        }));
        await tx`INSERT INTO kb_chunks ${tx(rows, "source_id", "kb_id", "title", "url", "content", "embedding")}`;
      }
      await tx`
        UPDATE kb_sources SET status = 'ready', error = NULL, pages = ${docs.length}, chars = ${Math.min(chars, MAX_CHARS)},
          chunks = ${chunks.length}, updated_at = now()
        WHERE id = ${id}`;
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Processing failed";
    await sql`UPDATE kb_sources SET status = 'error', error = ${message.slice(0, 500)}, updated_at = now() WHERE id = ${id}`;
  }
}

let running = 0;
const CONCURRENCY = 2;
/** A source "processing" for longer than this was cut off (restart, serverless timeout) and is retried. */
const STALE_MINUTES = 20;

async function claimNext(): Promise<string | null> {
  const [next] = await sql<{ id: string }[]>`
    UPDATE kb_sources SET status = 'processing', updated_at = now()
    WHERE id = (SELECT id FROM kb_sources WHERE status = 'queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id`;
  return next?.id ?? null;
}

/** Processes queued sources one after another until the queue is empty or the deadline passes. */
export async function drainQueue(deadline: number): Promise<number> {
  let done = 0;
  while (Date.now() < deadline) {
    const id = await claimNext();
    if (!id) break;
    await processSource(id);
    done++;
  }
  return done;
}

/** Puts sources that were cut off mid-processing back in the queue. */
export async function requeueStale(): Promise<number> {
  const rows = await sql`
    UPDATE kb_sources SET status = 'queued'
    WHERE status = 'processing' AND updated_at < now() - make_interval(mins => ${STALE_MINUTES})
    RETURNING id`;
  return rows.length;
}

/** Starts processing queued sources, if not already at capacity. */
export function kick(): void {
  if (process.env.VERCEL) {
    // Serverless: work only runs while a request is alive, so keep this request alive to process the
    // queue; whatever is left is picked up by the /api/cron/knowledge job.
    try {
      after(() => drainQueue(Date.now() + 240_000).catch((e) => console.error("knowledge: queue error", e)));
    } catch {
      // Outside a request; the cron job will process it.
    }
    return;
  }
  while (running < CONCURRENCY) {
    running++;
    void (async () => {
      try {
        await drainQueue(Number.POSITIVE_INFINITY);
      } catch (e) {
        console.error("knowledge: queue error", e);
      } finally {
        running--;
      }
    })();
  }
}

/** At startup: anything left "processing" by a restart goes back in the queue. */
export async function resumeKnowledgeQueue(): Promise<void> {
  await sql`UPDATE kb_sources SET status = 'queued' WHERE status = 'processing'`;
  kick();
}

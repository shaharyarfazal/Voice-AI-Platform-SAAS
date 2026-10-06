"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { addSource, resync } from "@/lib/knowledge/ingest";
import { searchKnowledge, type Hit } from "@/lib/knowledge/search";
import { assertPublicUrl } from "@/lib/net";
import { isUuid } from "@/lib/validation";

export type SourceState = { error?: string; added?: boolean } | undefined;

async function ownKb(tenantId: string, kbId: unknown): Promise<string | null> {
  if (typeof kbId !== "string" || !isUuid(kbId)) return null;
  const [kb] = await sql`SELECT id FROM knowledge_bases WHERE id = ${kbId} AND tenant_id = ${tenantId}`;
  return kb ? kbId : null;
}

export async function createKnowledgeBase(form: FormData) {
  const { tenantId } = await requireSession();
  const name = form.get("name")?.toString().trim() || "Knowledge base";
  const [kb] = await sql<{ id: string }[]>`INSERT INTO knowledge_bases (tenant_id, name) VALUES (${tenantId}, ${name.slice(0, 120)}) RETURNING id`;
  redirect(`/knowledge/${kb.id}`);
}

export async function renameKnowledgeBase(form: FormData) {
  const { tenantId } = await requireSession();
  const id = await ownKb(tenantId, form.get("id"));
  const name = form.get("name")?.toString().trim();
  if (id && name) await sql`UPDATE knowledge_bases SET name = ${name.slice(0, 120)} WHERE id = ${id}`;
  revalidatePath(`/knowledge/${id}`);
}

export async function deleteKnowledgeBase(form: FormData) {
  const { tenantId } = await requireSession();
  const id = await ownKb(tenantId, form.get("id"));
  if (id) {
    await sql`DELETE FROM knowledge_bases WHERE id = ${id}`;
    await sql`UPDATE agents SET knowledge_base_ids = array_remove(knowledge_base_ids, ${id}::uuid) WHERE tenant_id = ${tenantId}`;
  }
  redirect("/knowledge");
}

export async function addWebSource(_: SourceState, form: FormData): Promise<SourceState> {
  const { tenantId } = await requireSession();
  const kbId = await ownKb(tenantId, form.get("kbId"));
  if (!kbId) return { error: "Knowledge base not found." };
  const kind = form.get("kind") === "url" ? "url" : "website";
  let raw = form.get("url")?.toString().trim() ?? "";
  if (raw && !/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    await assertPublicUrl(raw, { allowHttp: true });
  } catch (e) {
    return { error: (e as Error).message };
  }
  const maxPages = z.coerce.number().int().min(1).max(200).catch(30).parse(form.get("maxPages"));
  await addSource(tenantId, kbId, { kind, title: new URL(raw).hostname + (kind === "url" ? new URL(raw).pathname : ""), url: raw, maxPages });
  revalidatePath(`/knowledge/${kbId}`);
  return { added: true };
}

export async function addTextSource(_: SourceState, form: FormData): Promise<SourceState> {
  const { tenantId } = await requireSession();
  const kbId = await ownKb(tenantId, form.get("kbId"));
  if (!kbId) return { error: "Knowledge base not found." };
  const title = form.get("title")?.toString().trim() || "Notes";
  const text = form.get("text")?.toString().trim() ?? "";
  if (text.length < 20) return { error: "Add some text: at least a sentence or two." };
  await addSource(tenantId, kbId, { kind: "text", title, content: text });
  revalidatePath(`/knowledge/${kbId}`);
  return { added: true };
}

export async function deleteSource(form: FormData) {
  const { tenantId } = await requireSession();
  const id = form.get("id")?.toString();
  if (isUuid(id)) await sql`DELETE FROM kb_sources WHERE id = ${id} AND tenant_id = ${tenantId}`;
  revalidatePath("/knowledge", "layout");
}

export async function resyncSource(form: FormData) {
  const { tenantId } = await requireSession();
  const id = form.get("id")?.toString();
  if (isUuid(id)) await resync(tenantId, id);
  revalidatePath("/knowledge", "layout");
}

export async function testSearch(kbId: string, query: string): Promise<Hit[]> {
  const { tenantId } = await requireSession();
  return searchKnowledge(tenantId, [kbId], query, 5);
}

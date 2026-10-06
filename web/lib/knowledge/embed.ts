import "server-only";

// Embeddings for semantic search, from OpenAI when the web app has OPENAI_API_KEY. Without it,
// search falls back to keyword (full-text) matching.

export const EMBEDDING_MODEL = "text-embedding-3-small";

export function embeddingsAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function embed(texts: string[]): Promise<number[][] | null> {
  if (!embeddingsAvailable() || texts.length === 0) return null;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 96) {
    const batch = texts.slice(i, i + 96).map((t) => t.slice(0, 8000));
    const res = await fetch(`${process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"}/embeddings`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Embeddings failed: HTTP ${res.status}`);
    const body = (await res.json()) as { data: { embedding: number[]; index: number }[] };
    out.push(...body.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
  }
  return out;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

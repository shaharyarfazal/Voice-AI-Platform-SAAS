// Splits text into overlapping pieces of about `size` characters, on paragraph and sentence
// boundaries where possible, so each piece makes sense on its own when it's retrieved.

export function chunkText(text: string, size = 1200, overlap = 200): string[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const pieces: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= size) pieces.push(p);
    else pieces.push(...(p.match(new RegExp(`[^.!?\\n]{1,${size}}(?:[.!?]+|$)`, "g")) ?? [p]).map((s) => s.trim()).filter(Boolean));
  }
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > size) {
      chunks.push(current);
      // Carry the end of the previous chunk over, so facts split across the boundary stay together.
      const tail = current.slice(-overlap);
      current = `${tail.slice(tail.indexOf(" ") + 1)}\n\n${piece}`;
    } else {
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks.map((c) => (c.length > size * 1.5 ? c.slice(0, size * 1.5) : c));
}

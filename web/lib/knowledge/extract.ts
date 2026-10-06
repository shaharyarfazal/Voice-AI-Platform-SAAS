import "server-only";
import { parse, type HTMLElement } from "node-html-parser";

// Turning web pages and documents into plain text for the knowledge base.

const DROP = "script, style, noscript, svg, iframe, template, nav, footer, header, form, button, [aria-hidden=true], .cookie, #cookie, .cookies";
const BLOCK = new Set(["P", "DIV", "SECTION", "ARTICLE", "LI", "TR", "H1", "H2", "H3", "H4", "H5", "H6", "BR", "TABLE", "UL", "OL", "MAIN", "ASIDE", "BLOCKQUOTE", "DD", "DT"]);

function textOf(el: HTMLElement): string {
  let out = "";
  for (const node of el.childNodes) {
    if (node.nodeType === 3) out += node.rawText;
    else if (node.nodeType === 1) {
      const child = node as HTMLElement;
      const inner = textOf(child);
      if (/^H[1-6]$/.test(child.tagName)) out += `\n\n## ${inner.trim()}\n`;
      else if (child.tagName === "LI") out += `\n- ${inner.trim()}`;
      else out += BLOCK.has(child.tagName) ? `\n${inner}\n` : inner;
    }
  }
  return out;
}

function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

export function tidy(text: string): string {
  return decode(text)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type Page = { url: string; title: string; text: string; links: string[] };

export function htmlToPage(html: string, url: string): Page {
  const root = parse(html, { blockTextElements: { script: false, style: false, noscript: false, pre: true } });
  const title = tidy(root.querySelector("title")?.text ?? root.querySelector("h1")?.text ?? url).slice(0, 200);
  const description = root.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
  const links = root
    .querySelectorAll("a[href]")
    .map((a) => a.getAttribute("href") ?? "")
    .filter((h) => h && !h.startsWith("#") && !/^(mailto|tel|javascript):/i.test(h));
  // Contact details often live in the header/footer, so keep tel/mailto text before dropping them.
  const contacts = root
    .querySelectorAll('a[href^="tel:"], a[href^="mailto:"]')
    .map((a) => (a.getAttribute("href") ?? "").replace(/^(tel|mailto):/i, "").trim())
    .filter(Boolean);
  const body = root.querySelector("main") ?? root.querySelector("article") ?? root.querySelector("body") ?? root;
  body.querySelectorAll(DROP).forEach((el) => el.remove());
  const text = tidy([description, textOf(body), contacts.length ? `Contact: ${[...new Set(contacts)].join(", ")}` : ""].filter(Boolean).join("\n\n"));
  return { url, title, text, links };
}

export async function pdfToText(data: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: false });
  return tidy((Array.isArray(text) ? text : [text]).join("\n\n"));
}

export async function docxToText(data: Uint8Array): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(data) });
  return tidy(value);
}

export const FILE_TYPES: Record<string, { label: string; parse: (data: Uint8Array) => Promise<string> }> = {
  pdf: { label: "PDF", parse: pdfToText },
  docx: { label: "Word", parse: docxToText },
  txt: { label: "Text", parse: async (d) => tidy(new TextDecoder().decode(d)) },
  md: { label: "Markdown", parse: async (d) => tidy(new TextDecoder().decode(d)) },
  csv: { label: "CSV", parse: async (d) => new TextDecoder().decode(d).trim() },
};

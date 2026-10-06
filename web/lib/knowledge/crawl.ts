import "server-only";
import { fetchPublic } from "../net";
import { htmlToPage, pdfToText, type Page } from "./extract";

// Reads a business website: the start page, its sitemap, and same-site links, breadth first.

const SKIP = /\.(jpe?g|png|gif|webp|svg|ico|css|js|mjs|json|xml|zip|gz|mp4|mp3|wav|mov|avi|woff2?|ttf|eot|docx?|xlsx?|pptx?)(\?|$)/i;
const SKIP_PATHS = /\/(wp-admin|wp-login|login|signin|sign-in|logout|cart|checkout|account|my-account|feed|tag|author)(\/|$)/i;

function sameSite(a: URL, b: URL): boolean {
  return a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, "");
}

function normalise(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    for (const p of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$)/.test(p)) u.searchParams.delete(p);
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

async function robotsDisallows(origin: string): Promise<{ rules: string[]; sitemaps: string[] }> {
  try {
    const res = await fetchPublic(`${origin}/robots.txt`, { maxBytes: 200_000, timeoutMs: 6000 });
    if (!res) return { rules: [], sitemaps: [] };
    const rules: string[] = [];
    const sitemaps: string[] = [];
    let applies = false;
    for (const line of new TextDecoder().decode(res.body).split("\n")) {
      const [k, ...rest] = line.split(":");
      const key = k.trim().toLowerCase();
      const value = rest.join(":").trim();
      if (key === "user-agent") applies = value === "*";
      else if (key === "disallow" && applies && value) rules.push(value);
      else if (key === "sitemap" && value) sitemaps.push(value);
    }
    return { rules, sitemaps };
  } catch {
    return { rules: [], sitemaps: [] };
  }
}

async function sitemapUrls(urls: string[], limit: number): Promise<string[]> {
  const found: string[] = [];
  const queue = [...urls];
  for (let i = 0; i < queue.length && i < 5 && found.length < limit; i++) {
    try {
      const res = await fetchPublic(queue[i], { maxBytes: 3_000_000, timeoutMs: 8000 });
      if (!res) continue;
      const xml = new TextDecoder().decode(res.body);
      for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
        const loc = m[1].replace(/&amp;/g, "&");
        if (/\.xml(\?|$)/i.test(loc)) queue.push(loc);
        else found.push(loc);
      }
    } catch {
      // a missing or broken sitemap just means relying on links
    }
  }
  return found;
}

export type CrawlProgress = (done: number, total: number) => void;

export async function crawlWebsite(startUrl: string, maxPages: number, onProgress?: CrawlProgress): Promise<Page[]> {
  const start = new URL(startUrl);
  const origin = start.origin;
  const robots = await robotsDisallows(origin);
  const allowed = (u: URL) => sameSite(u, start) && !robots.rules.some((r) => u.pathname.startsWith(r)) && !SKIP_PATHS.test(u.pathname);

  const seen = new Set<string>();
  const queue: string[] = [];
  const add = (href: string, base: string) => {
    const n = normalise(href, base);
    if (!n || seen.has(n) || SKIP.test(n)) return;
    const u = new URL(n);
    if (!allowed(u)) return;
    seen.add(n);
    queue.push(n);
  };
  add(startUrl, startUrl);
  for (const u of await sitemapUrls([...robots.sitemaps, `${origin}/sitemap.xml`], maxPages * 3)) add(u, origin);

  const pages: Page[] = [];
  const texts = new Set<string>();
  let index = 0;
  let active = 0;
  const worker = async () => {
    for (;;) {
      if (pages.length >= maxPages) return;
      if (index >= queue.length) {
        // Others may still add links; stop only when nothing is in flight.
        if (active === 0) return;
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }
      const url = queue[index++];
      active++;
      try {
        const res = await fetchPublic(url, { maxBytes: 8_000_000, accept: "text/html,application/pdf;q=0.9,*/*;q=0.5" });
        if (!res) continue;
        let page: Page;
        if (res.contentType.includes("pdf") || /\.pdf(\?|$)/i.test(url)) {
          page = { url, title: decodeURIComponent(url.split("/").pop() || url), text: await pdfToText(res.body), links: [] };
        } else if (res.contentType.includes("html") || res.contentType === "") {
          page = htmlToPage(new TextDecoder().decode(res.body), res.url);
        } else continue;
        for (const l of page.links) add(l, res.url);
        const key = page.text.slice(0, 2000);
        if (page.text.length < 80 || texts.has(key)) continue; // empty or duplicate page
        texts.add(key);
        if (pages.length < maxPages) pages.push(page);
        onProgress?.(pages.length, Math.min(maxPages, queue.length));
      } catch {
        // skip pages that time out, are too large, or point somewhere private
      } finally {
        active--;
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return pages;
}

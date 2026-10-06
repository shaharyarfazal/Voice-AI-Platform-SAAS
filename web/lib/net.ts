import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isPrivateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateV4(ip);
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(?:([\d.]+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/);
  if (mapped) {
    // IPv4-mapped, written either as ::ffff:1.2.3.4 or (as URL parsing normalises it) ::ffff:102:304.
    if (mapped[1]) return isPrivateV4(mapped[1]);
    const hi = parseInt(mapped[2], 16), lo = parseInt(mapped[3], 16);
    return isPrivateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return v6 === "::" || v6 === "::1" || v6.startsWith("64:ff9b:") || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith("ff");
}

/**
 * Throws unless the URL is https on a host that resolves only to public addresses, so clients
 * can't point webhooks at the server itself or its private network.
 * WEBHOOKS_ALLOW_PRIVATE_URLS=true lifts this (webhooks and website scraping) for local development only.
 */
export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  return assertPublicUrl(raw, { allowHttp: false });
}

/** Like assertPublicHttpsUrl; `allowHttp` also accepts plain http (for scraping public websites). */
export async function assertPublicUrl(raw: string, { allowHttp }: { allowHttp: boolean }): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Not a valid URL");
  }
  if (process.env.WEBHOOKS_ALLOW_PRIVATE_URLS === "true") return url;
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    throw new Error(allowHttp ? "Only http:// and https:// addresses are supported" : "Webhook URLs must use https://");
  }
  if (url.username || url.password) throw new Error("URLs with a username or password aren't allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(isPrivateIp)) throw new Error("The address must point to a public server");
  return url;
}

/**
 * GET a public URL, following up to 5 redirects and checking every hop, with a size cap.
 * Returns null for non-2xx answers.
 */
export async function fetchPublic(
  raw: string,
  { maxBytes = 5_000_000, timeoutMs = 12_000, accept = "*/*" }: { maxBytes?: number; timeoutMs?: number; accept?: string } = {},
): Promise<{ url: string; contentType: string; body: Uint8Array } | null> {
  let current = raw;
  for (let hop = 0; hop < 6; hop++) {
    await assertPublicUrl(current, { allowHttp: true });
    const res = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": "Mozilla/5.0 (compatible; KnowledgeBot/1.0)", accept },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel().catch(() => {});
      current = new URL(res.headers.get("location")!, current).toString();
      continue;
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error("The file is too large");
      }
      parts.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const p of parts) {
      body.set(p, offset);
      offset += p.length;
    }
    return { url: current, contentType: res.headers.get("content-type") ?? "", body };
  }
  throw new Error("Too many redirects");
}

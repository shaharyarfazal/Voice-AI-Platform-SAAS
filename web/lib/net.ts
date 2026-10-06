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
 * WEBHOOKS_ALLOW_PRIVATE_URLS=true lifts this for local development only.
 */
export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Not a valid URL");
  }
  if (process.env.WEBHOOKS_ALLOW_PRIVATE_URLS === "true") return url;
  if (url.protocol !== "https:") throw new Error("Webhook URLs must use https://");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(isPrivateIp)) throw new Error("Webhook URLs must point to a public server");
  return url;
}

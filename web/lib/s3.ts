import "server-only";
import { encodeRfc3986, presignUrl } from "./sigv4";

// Presigned URLs for any S3-compatible object store (AWS S3, Cloudflare R2, Backblaze B2, MinIO).
// Path-style addressing, so the endpoint can be any host. No SDK needed: the agent worker uploads
// straight to the URL and browsers download from it.

export type S3Config = { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string };

export function s3Config(): S3Config | null {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_REGION } = process.env;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) return null;
  return { endpoint: S3_ENDPOINT.replace(/\/+$/, ""), bucket: S3_BUCKET, region: S3_REGION || "auto", accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY };
}

export function presign(
  config: S3Config,
  method: "GET" | "PUT" | "HEAD" | "DELETE",
  key: string,
  opts: { expiresSeconds?: number; query?: Record<string, string> } = {},
): string {
  const url = new URL(config.endpoint);
  return presignUrl({
    method,
    protocol: url.protocol,
    host: url.host,
    path: `${url.pathname.replace(/\/$/, "")}/${encodeRfc3986(config.bucket)}/${key.split("/").map(encodeRfc3986).join("/")}`,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    expiresSeconds: opts.expiresSeconds ?? 900,
    now: new Date(),
    query: opts.query,
  });
}

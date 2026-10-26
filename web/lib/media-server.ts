import "server-only";
import { sql } from "./db";

/** Which LiveKit server browser calls (dashboard tests and widgets) use. Phone calls always use the VPS. */
export type MediaServer = "self-hosted" | "cloud";

export function cloudConfigured(): boolean {
  return Boolean(process.env.LIVEKIT_CLOUD_URL && process.env.LIVEKIT_CLOUD_API_KEY && process.env.LIVEKIT_CLOUD_API_SECRET);
}

/** The admin's choice from Admin > System, else LIVEKIT_WEB_CALLS; cloud only when its credentials are set. */
export async function getMediaServer(): Promise<MediaServer> {
  const [row] = await sql<{ value: { target?: string } }[]>`SELECT value FROM platform_settings WHERE key = 'media_server'`;
  const target = row?.value?.target ?? process.env.LIVEKIT_WEB_CALLS;
  return target === "cloud" && cloudConfigured() ? "cloud" : "self-hosted";
}

export async function setMediaServer(target: MediaServer): Promise<void> {
  await sql`
    INSERT INTO platform_settings (key, value) VALUES ('media_server', ${sql.json({ target })})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

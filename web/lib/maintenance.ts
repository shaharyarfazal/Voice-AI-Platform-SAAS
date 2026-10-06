import "server-only";
import { sql } from "./db";
import { deleteRecording } from "./recordings";

const HOUR = 60 * 60 * 1000;

/**
 * Clears transcripts, recordings and analyses older than each tenant's retention period.
 * Call records and usage stay for billing.
 */
export async function purgeOldTranscripts(): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    UPDATE calls c SET transcript = '[]', transcript_purged_at = now(), has_recording = false, analysis = NULL
    FROM tenants t
    WHERE t.id = c.tenant_id
      AND c.transcript_purged_at IS NULL
      AND c.ended_at < now() - make_interval(days => t.transcript_retention_days)
    RETURNING c.id`;
  for (const { id } of rows) await deleteRecording(id);
  return rows.length;
}

export function startMaintenance(): void {
  const run = () =>
    purgeOldTranscripts()
      .then((n) => n > 0 && console.log(`purged ${n} transcripts past retention`))
      .catch((e) => console.error("transcript purge failed", e));
  run();
  setInterval(run, HOUR).unref();
}

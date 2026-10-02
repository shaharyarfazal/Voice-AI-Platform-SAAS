import Link from "next/link";
import type { CallRow } from "@/lib/db";
import { formatDateTime, formatDuration } from "@/lib/format";

export function CallTable({ calls }: { calls: CallRow[] }) {
  if (calls.length === 0) return <p className="text-sm text-muted">No calls yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>When</th>
            <th>Agent</th>
            <th>Channel</th>
            <th>From</th>
            <th>Duration</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((c) => (
            <tr key={c.id}>
              <td>
                <Link className="underline" href={`/calls/${c.id}`}>{formatDateTime(c.started_at)}</Link>
              </td>
              <td>{c.agent_name ?? "—"}</td>
              <td>{c.channel}</td>
              <td>{c.from_number ?? "—"}</td>
              <td>{formatDuration(c.duration_seconds)}</td>
              <td>{c.outcome.replaceAll("_", " ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

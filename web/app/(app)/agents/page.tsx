import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { sql } from "@/lib/db";

export default async function AgentsPage() {
  const { tenantId } = await requireSession();
  const agents = await sql`
    SELECT a.id, a.name, a.llm_model, count(p.id)::int AS numbers
    FROM agents a LEFT JOIN phone_numbers p ON p.agent_id = a.id
    WHERE a.tenant_id = ${tenantId} GROUP BY a.id ORDER BY a.created_at`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Agents</h1>
        <Link className="btn" href="/agents/new">New agent</Link>
      </div>
      {agents.length === 0 ? (
        <p className="text-sm text-muted">No agents yet. Create one to start taking calls.</p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {agents.map((a) => (
            <li key={a.id}>
              <Link href={`/agents/${a.id}`} className="card block hover:bg-black/5 dark:hover:bg-white/5">
                <div className="font-medium">{a.name}</div>
                <div className="mt-1 text-sm text-muted">
                  {a.llm_model} · {a.numbers} phone number{a.numbers === 1 ? "" : "s"}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

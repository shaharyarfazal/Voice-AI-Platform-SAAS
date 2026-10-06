import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { WidgetForm } from "../widget-form";

export default async function NewWidgetPage({ searchParams }: PageProps<"/widgets/new">) {
  const { tenantId } = await requireSession();
  const { agent } = await searchParams;
  const agents = await sql<{ id: string; name: string; type: string }[]>`SELECT id, name, type FROM agents WHERE tenant_id = ${tenantId} ORDER BY created_at`;
  const [tenant] = await sql<{ website: string | null }[]>`SELECT website FROM tenants WHERE id = ${tenantId}`;
  const chosen = agents.find((a) => a.id === agent) ?? agents.find((a) => a.type === "chat") ?? agents[0];
  return (
    <div className="space-y-6">
      <div>
        <Link href="/widgets" className="text-sm text-muted hover:underline">← Widgets</Link>
        <h1 className="page-title mt-1">New widget</h1>
      </div>
      {agents.length === 0 ? (
        <p className="text-sm text-muted">Create an agent or chatbot first. <Link className="text-accent underline" href="/agents/new?type=chat">New chatbot</Link></p>
      ) : (
        <WidgetForm
          agents={agents}
          initial={{
            name: "Website widget",
            agentId: chosen.id,
            mode: chosen.type === "chat" ? "chat" : "both",
            enabled: true,
            origins: tenant?.website ? new URL(tenant.website).origin : "",
            appearance: { title: "Chat with us", subtitle: "We usually reply instantly", color: "#2563eb", position: "right", launcherLabel: "" },
          }}
        />
      )}
    </div>
  );
}

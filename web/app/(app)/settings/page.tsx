import { hasRole, requireSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { WorkspaceForm } from "./workspace-form";

export default async function WorkspaceSettingsPage() {
  const session = await requireSession();
  const [t] = await sql<{ name: string; website: string | null; parent: string | null; created_at: Date }[]>`
    SELECT t.name, t.website, p.name AS parent, t.created_at FROM tenants t LEFT JOIN tenants p ON p.id = t.parent_id WHERE t.id = ${session.tenantId}`;
  return (
    <div className="max-w-xl space-y-4">
      {t.parent && <p className="rounded-lg bg-surface p-3 text-sm text-muted">This workspace is managed by {t.parent}.</p>}
      <WorkspaceForm name={t.name} website={t.website ?? ""} canEdit={hasRole(session, "admin")} />
      <p className="text-sm text-muted">Your role here: <span className="font-medium text-foreground">{session.role}</span></p>
    </div>
  );
}

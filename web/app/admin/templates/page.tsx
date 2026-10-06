import { requireAdmin } from "@/lib/auth";
import { getTemplates } from "@/lib/templates";
import { resetTemplates } from "./actions";
import { TemplatesForm } from "./templates-form";

export default async function TemplatesPage() {
  await requireAdmin();
  const templates = await getTemplates();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Agent templates</h1>
        <p className="page-sub">
          New clients get three agents from these when they finish the setup wizard. Changes apply to agents created from now on;
          clients can edit their own agents freely.
        </p>
      </div>
      <TemplatesForm templates={templates} />
      <form action={resetTemplates}>
        <button className="text-sm text-muted underline">Reset to the built-in templates</button>
      </form>
    </div>
  );
}

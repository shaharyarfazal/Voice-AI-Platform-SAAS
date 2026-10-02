import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { AgentEditor } from "../editor/agent-editor";
import { loadEditorContext } from "../editor/load-context";
import { toEditorState } from "../editor/to-state";

export default async function NewAgentPage() {
  const { tenantId } = await requireSession();
  return (
    <div className="space-y-6">
      <div>
        <Link href="/agents" className="text-sm text-muted hover:underline">← Agents</Link>
        <h1 className="page-title mt-1">New agent</h1>
      </div>
      <AgentEditor initial={toEditorState()} context={await loadEditorContext(tenantId)} />
    </div>
  );
}

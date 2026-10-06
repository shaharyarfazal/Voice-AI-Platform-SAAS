import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { AgentEditor } from "../editor/agent-editor";
import { loadEditorContext } from "../editor/load-context";
import { toEditorState } from "../editor/to-state";

export default async function NewAgentPage({ searchParams }: PageProps<"/agents/new">) {
  const { tenantId } = await requireSession();
  const { type } = await searchParams;
  const kind = type === "chat" || type === "outbound" ? type : "inbound";
  return (
    <div className="space-y-6">
      <div>
        <Link href={kind === "chat" ? "/chatbots" : "/agents"} className="text-sm text-muted hover:underline">← {kind === "chat" ? "Chatbots" : "Voice agents"}</Link>
        <h1 className="page-title mt-1">{kind === "chat" ? "New chatbot" : "New agent"}</h1>
      </div>
      <AgentEditor initial={toEditorState(undefined, "UTC", kind)} context={await loadEditorContext(tenantId)} />
    </div>
  );
}

import { requireSession } from "@/lib/auth";
import { AgentList } from "../agents/agent-list";

export default async function ChatbotsPage() {
  const { tenantId } = await requireSession();
  return (
    <AgentList
      tenantId={tenantId}
      types={["chat"]}
      title="Chatbots"
      sub="Text chat on your website with the same knowledge, booking and tools as your voice agents."
      newHref="/agents/new?type=chat"
      empty="Create a chatbot, connect your knowledge base, then put it on your website with a widget."
    />
  );
}

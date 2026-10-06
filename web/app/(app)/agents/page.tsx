import { requireSession } from "@/lib/auth";
import { AgentList } from "./agent-list";

export default async function AgentsPage() {
  const { tenantId } = await requireSession();
  return (
    <AgentList
      tenantId={tenantId}
      types={["inbound", "outbound"]}
      title="Voice agents"
      sub="Answer calls on your numbers, call people back, and talk to website visitors."
      newHref="/agents/new"
      empty="Create an inbound agent to answer your phone, or an outbound one to make calls."
    />
  );
}

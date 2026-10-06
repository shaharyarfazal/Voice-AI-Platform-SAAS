import { loadChatAgent, startChat } from "@/lib/chat/sessions";
import { chatToken, guard, json } from "@/lib/widgets";
import { preflight } from "../preflight";

type Ctx = RouteContext<"/api/widget/[key]/chat">;

export async function OPTIONS(request: Request, { params }: Ctx) {
  return preflight(request, (await params).key);
}

// Starts a chat. Returns a token that the browser must send with every message.
export async function POST(request: Request, { params }: Ctx) {
  const g = await guard(request, (await params).key, { name: "chat-start", perIp: 10, perWidget: 600, windowMs: 3_600_000 });
  if (g instanceof Response) return g;
  if (g.widget.mode === "voice") return json({ error: "This widget is for calls only." }, 400, g.origin);
  const agent = await loadChatAgent(g.widget.agent_id);
  if (!agent) return json({ error: "This assistant isn't available." }, 404, g.origin);
  const body = (await request.json().catch(() => ({}))) as { page?: unknown };
  const page = typeof body.page === "string" ? body.page.slice(0, 500) : null;
  const session = await startChat(agent, { channel: "widget", widgetId: g.widget.id, visitor: { page, origin: g.origin } });
  return json({ sessionId: session.id, token: chatToken(session.id, g.widget.id), greeting: session.greeting }, 200, g.origin);
}

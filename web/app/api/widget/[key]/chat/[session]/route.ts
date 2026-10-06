import { sql } from "@/lib/db";
import { MAX_MESSAGE_CHARS, sendChatMessage } from "@/lib/chat/sessions";
import { isUuid } from "@/lib/validation";
import { guard, json, verifyChatToken } from "@/lib/widgets";
import { preflight } from "../../preflight";

type Ctx = RouteContext<"/api/widget/[key]/chat/[session]">;

export async function OPTIONS(request: Request, { params }: Ctx) {
  return preflight(request, (await params).key);
}

// A visitor's message; returns the chatbot's reply.
export async function POST(request: Request, { params }: Ctx) {
  const { key, session } = await params;
  const g = await guard(request, key, { name: "chat-msg", perIp: 20, perWidget: 3000, windowMs: 60_000 });
  if (g instanceof Response) return g;
  const body = (await request.json().catch(() => ({}))) as { token?: unknown; text?: unknown };
  if (!isUuid(session) || typeof body.token !== "string" || !verifyChatToken(session, g.widget.id, body.token)) {
    return json({ error: "This conversation has expired. Start a new one." }, 403, g.origin);
  }
  if (typeof body.text !== "string" || body.text.length > MAX_MESSAGE_CHARS) {
    return json({ error: `Messages can be up to ${MAX_MESSAGE_CHARS} characters.` }, 400, g.origin);
  }
  const [row] = await sql<{ tenant_id: string }[]>`SELECT tenant_id FROM chat_sessions WHERE id = ${session} AND widget_id = ${g.widget.id}`;
  if (!row) return json({ error: "This conversation has expired. Start a new one." }, 404, g.origin);
  const result = await sendChatMessage(session, row.tenant_id, body.text);
  return "reply" in result ? json({ reply: result.reply }, 200, g.origin) : json({ error: result.error }, result.status, g.origin);
}

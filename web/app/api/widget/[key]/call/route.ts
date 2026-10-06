import { createWidgetCallToken } from "@/lib/livekit";
import { guard, json } from "@/lib/widgets";
import { preflight } from "../preflight";

type Ctx = RouteContext<"/api/widget/[key]/call">;

export async function OPTIONS(request: Request, { params }: Ctx) {
  return preflight(request, (await params).key);
}

// Click-to-call: a short-lived token for one browser call with the widget's agent.
export async function POST(request: Request, { params }: Ctx) {
  const g = await guard(request, (await params).key, { name: "call", perIp: 5, perWidget: 200, windowMs: 3_600_000 });
  if (g instanceof Response) return g;
  if (g.widget.mode === "chat") return json({ error: "This widget is for chat only." }, 400, g.origin);
  return json(await createWidgetCallToken(g.widget.agent_id, g.widget.id), 200, g.origin);
}

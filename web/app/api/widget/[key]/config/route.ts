import { guard, json, publicConfig } from "@/lib/widgets";
import { preflight } from "../preflight";

type Ctx = RouteContext<"/api/widget/[key]/config">;

export async function OPTIONS(request: Request, { params }: Ctx) {
  return preflight(request, (await params).key);
}

// Public: how the widget looks and what it offers. No secrets.
export async function GET(request: Request, { params }: Ctx) {
  const g = await guard(request, (await params).key, { name: "config", perIp: 60, perWidget: 5000, windowMs: 60_000 });
  if (g instanceof Response) return g;
  return json(await publicConfig(g.widget), 200, g.origin);
}

import { corsHeaders, loadWidget, originAllowed } from "@/lib/widgets";

/** CORS preflight: allowed only for websites on the widget's list. */
export async function preflight(request: Request, key: string): Promise<Response> {
  const origin = request.headers.get("origin");
  const widget = await loadWidget(key);
  if (!widget || !originAllowed(widget, origin, request)) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

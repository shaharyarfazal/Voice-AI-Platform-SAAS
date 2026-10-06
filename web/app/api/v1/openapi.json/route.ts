import { ENDPOINTS } from "@/lib/api/spec";
import { publicUrl } from "@/lib/oauth";

// OpenAPI 3.1 description of the public API, for Postman, code generators and AI tools.
export function GET() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of ENDPOINTS) {
    const params = [
      ...[...e.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } })),
      ...(e.query ?? []).map((q) => ({ name: q.name, in: "query", required: Boolean(q.required), description: q.description, schema: { type: q.type === "integer" ? "integer" : "string" } })),
    ];
    paths[`/api${e.path}`] ??= {};
    paths[`/api${e.path}`][e.method.toLowerCase()] = {
      operationId: e.id,
      tags: [e.group],
      summary: e.summary,
      description: e.description,
      parameters: params.length ? params : undefined,
      requestBody: e.body
        ? {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: Object.fromEntries(e.body.filter((f) => !f.name.includes(" ")).map((f) => [f.name, { description: f.description, type: f.type.endsWith("[]") ? "array" : f.type === "integer" ? "integer" : f.type }])),
                  required: e.body.filter((f) => f.required).map((f) => f.name),
                },
                example: e.example,
              },
            },
          }
        : undefined,
      responses: { "200": { description: "OK", content: { "application/json": { example: e.response } } } },
    };
  }
  return Response.json({
    openapi: "3.1.0",
    info: { title: "Voice agent API", version: "1.0.0" },
    servers: [{ url: publicUrl("/").origin }],
    components: { securitySchemes: { apiKey: { type: "http", scheme: "bearer", description: "An API key from Settings > API keys (vk_…)." } } },
    security: [{ apiKey: [] }],
    paths,
  });
}

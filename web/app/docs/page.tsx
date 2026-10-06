import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { ENDPOINTS, type Endpoint, type Field } from "@/lib/api/spec";
import { brandingForHost } from "@/lib/workspace";
import { CodeBlock } from "./code-block";

export const metadata: Metadata = { title: "API reference" };

const METHOD_STYLE: Record<Endpoint["method"], string> = {
  GET: "bg-[#2a78d6]/15 text-[#1f5fae] dark:text-[#7fb1ee]",
  POST: "bg-[#0ca30c]/15 text-[#087a08] dark:text-[#5fd35f]",
  PATCH: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  DELETE: "bg-[#d03b3b]/15 text-[#b02a2a] dark:text-[#f08a8a]",
};

const groups = [...new Set(ENDPOINTS.map((e) => e.group))];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

function curl(base: string, e: Endpoint): string {
  const path = e.path.replace(/\{(\w+)\}/g, (_, p: string) => `$${p.toUpperCase()}`);
  const lines = [`curl -X ${e.method} "${base}/api${path}" \\`, `  -H "Authorization: Bearer $API_KEY"`];
  if (e.example !== undefined) {
    lines[lines.length - 1] += " \\";
    lines.push(`  -H "Content-Type: application/json" \\`, `  -d '${JSON.stringify(e.example)}'`);
  }
  return lines.join("\n");
}

function Fields({ title, fields }: { title: string; fields: Field[] }) {
  return (
    <div>
      <h4 className="mb-2 text-sm font-medium">{title}</h4>
      <dl className="divide-y divide-border rounded-lg border border-border text-sm">
        {fields.map((f) => (
          <div key={f.name} className="grid gap-1 p-3 sm:grid-cols-[200px_1fr]">
            <dt>
              <code className="font-medium">{f.name}</code> <span className="text-xs text-muted">{f.type}</span>
              {f.required && <span className="ml-1 text-xs text-critical">required</span>}
            </dt>
            <dd className="text-muted">{f.description || "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default async function DocsPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "app.example.com";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = `${proto}://${host}`;
  const brand = await brandingForHost();

  return (
    <div className="mx-auto flex w-full max-w-6xl gap-10 px-4 py-10">
      <nav className="sticky top-6 hidden h-[calc(100vh-3rem)] w-56 shrink-0 overflow-y-auto text-sm lg:block" aria-label="API sections">
        <Link href="/" className="mb-6 block font-semibold">{brand.productName}</Link>
        <ul className="space-y-1">
          {["Introduction", "Authentication", "Errors and limits"].map((s) => (
            <li key={s}><a className="text-muted hover:text-foreground" href={`#${slug(s)}`}>{s}</a></li>
          ))}
        </ul>
        {groups.map((g) => (
          <div key={g} className="mt-5">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{g}</div>
            <ul className="space-y-1">
              {ENDPOINTS.filter((e) => e.group === g).map((e) => (
                <li key={e.id}><a className="text-muted hover:text-foreground" href={`#${e.id}`}>{e.summary}</a></li>
              ))}
            </ul>
          </div>
        ))}
        <div className="mt-5 mb-1 text-xs font-medium uppercase tracking-wide text-muted">Guides</div>
        <ul className="space-y-1">
          <li><a className="text-muted hover:text-foreground" href="#webhooks">Webhooks</a></li>
          <li><a className="text-muted hover:text-foreground" href="#widgets">Website widgets</a></li>
        </ul>
      </nav>

      <main className="min-w-0 flex-1 space-y-16">
        <section id="introduction" className="space-y-4">
          <h1 className="page-title">API reference</h1>
          <p className="text-muted">
            Manage agents, place outbound calls, read calls with transcripts and recordings, chat with your agents and keep the knowledge base up to date,
            from your own code or tools like n8n, Make and Zapier.
          </p>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="badge">Base URL: <code>{base}/api</code></span>
            <a className="badge hover:border-accent" href="/api/v1/openapi.json">OpenAPI 3.1 file</a>
            <Link className="badge hover:border-accent" href="/settings/api-keys">Get an API key</Link>
          </div>
        </section>

        <section id="authentication" className="space-y-3">
          <h2 className="text-xl font-semibold">Authentication</h2>
          <p className="text-sm text-muted">
            Create a key under <strong className="text-foreground">Settings → API keys</strong> (owners and admins). Keys belong to one workspace,
            can expire, and are shown only once. Send it as a bearer token. Keep keys on your server: never put them in a website or app.
          </p>
          <CodeBlock code={`curl ${base}/api/v1/agents \\\n  -H "Authorization: Bearer vk_your_key"`} />
        </section>

        <section id="errors-and-limits" className="space-y-3">
          <h2 className="text-xl font-semibold">Errors and limits</h2>
          <p className="text-sm text-muted">Errors use HTTP status codes and a JSON body:</p>
          <CodeBlock code={JSON.stringify({ error: { code: "invalid_request", message: "to_number: The number to call must be in E.164 format" } }, null, 2)} />
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            <li><code>400</code> invalid_request · <code>401</code> unauthorized · <code>404</code> not_found · <code>429</code> rate_limited · <code>5xx</code> server or carrier errors</li>
            <li>120 requests a minute per key; at most 10 outbound calls running at once per workspace.</li>
            <li>Times are ISO 8601 in UTC; phone numbers are E.164 (<code>+14155550100</code>).</li>
          </ul>
        </section>

        {groups.map((g) => (
          <section key={g} id={slug(g)} className="space-y-12">
            <h2 className="border-b border-border pb-2 text-xl font-semibold">{g}</h2>
            {ENDPOINTS.filter((e) => e.group === g).map((e) => (
              <article key={e.id} id={e.id} className="scroll-mt-6 space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-lg font-semibold">{e.summary}</h3>
                </div>
                <div className="flex flex-wrap items-center gap-2 font-mono text-sm">
                  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${METHOD_STYLE[e.method]}`}>{e.method}</span>
                  <span className="break-all">/api{e.path}</span>
                </div>
                {e.description && <p className="text-sm text-muted">{e.description}</p>}
                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="min-w-0 space-y-4">
                    {e.query && <Fields title="Query parameters" fields={e.query} />}
                    {e.body && <Fields title="Body" fields={e.body} />}
                    <div>
                      <h4 className="mb-2 text-sm font-medium">Request</h4>
                      <CodeBlock code={curl(base, e)} />
                    </div>
                  </div>
                  <div className="min-w-0">
                    <h4 className="mb-2 text-sm font-medium">Response</h4>
                    <CodeBlock code={JSON.stringify(e.response, null, 2)} />
                  </div>
                </div>
              </article>
            ))}
          </section>
        ))}

        <section id="webhooks" className="space-y-4">
          <h2 className="border-b border-border pb-2 text-xl font-semibold">Webhooks</h2>
          <p className="text-sm text-muted">
            Set a webhook URL on an agent (agent → Recording &amp; webhooks). It receives <code>call_started</code>, <code>call_ended</code> and{" "}
            <code>call_analyzed</code> as JSON POSTs with the same <code>call_id</code>, for inbound, outbound and web calls. <code>call_ended</code> includes
            the transcript and an MP3 recording link; <code>call_analyzed</code> adds the AI summary, sentiment, success and your custom fields. The call
            object is the same as Get a call.
          </p>
          <CodeBlock code={JSON.stringify({ event: "call_analyzed", call: { call_id: "82980c6d…", direction: "outbound", "…": "…" } }, null, 2)} />
          <h3 className="font-semibold">Verifying the signature</h3>
          <p className="text-sm text-muted">
            Each request has <code>x-webhook-timestamp</code> and <code>x-webhook-signature</code> (<code>v1=</code> + HMAC-SHA256 of
            <code> timestamp.body</code> with your signing secret). Failed deliveries are retried after 10 and 60 seconds.
          </p>
          <CodeBlock
            code={`import { createHmac, timingSafeEqual } from "node:crypto";

function isValid(rawBody, headers, secret) {
  const ts = headers["x-webhook-timestamp"];
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = "v1=" + createHmac("sha256", secret).update(\`\${ts}.\${rawBody}\`).digest("hex");
  const given = headers["x-webhook-signature"] ?? "";
  return expected.length === given.length && timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}`}
          />
        </section>

        <section id="widgets" className="space-y-4 pb-24">
          <h2 className="border-b border-border pb-2 text-xl font-semibold">Website widgets</h2>
          <p className="text-sm text-muted">
            Create a widget under <strong className="text-foreground">Widgets</strong>, pick its agent and mode (chat, click-to-call or both), list the
            websites allowed to use it, and paste the embed code before <code>&lt;/body&gt;</code>:
          </p>
          <CodeBlock code={`<script src="${base}/widget.js" data-widget="wpk_…" async></script>`} />
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            <li>The <code>wpk_</code> key is public by design: it can only chat with or call that widget&apos;s agent, from the allowed websites, within rate limits. Your API keys never go in a page.</li>
            <li>Every conversation gets its own signed token; visitors can&apos;t read or write other conversations.</li>
            <li>Visitor messages are treated as untrusted: length-limited, never shown as HTML, and the agent is instructed to ignore attempts to change its rules. Knowledge base results are passed to the AI as reference data, not instructions.</li>
            <li>Voice calls use a short-lived token for one room with the agent; the agent&apos;s call time limit and your monthly minute limit apply.</li>
          </ul>
        </section>
      </main>
    </div>
  );
}

import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { isConfigured, type OAuthProvider } from "@/lib/oauth";
import { disconnectIntegration } from "./actions";

const ERRORS: Record<string, string> = {
  denied: "The connection was cancelled.",
  provider: "The provider returned an error. Try again.",
  expired: "The connection took too long. Try again.",
  not_configured: "This integration hasn't been set up by the platform yet.",
};

const PROVIDERS: { id: OAuthProvider; name: string; logo: string; blurb: string }[] = [
  { id: "google", name: "Google Calendar", logo: "G", blurb: "Check free times and book appointments in Google Calendar. Callers who give an email get a Google invitation." },
  { id: "microsoft", name: "Microsoft Outlook", logo: "M", blurb: "Check free times and book appointments in Outlook / Microsoft 365. Callers who give an email get an Outlook invitation." },
];

export default async function IntegrationsPage({ searchParams }: PageProps<"/integrations">) {
  const { tenantId } = await requireSession();
  const sp = await searchParams;
  const connections = await sql<{ id: string; provider: OAuthProvider; account_email: string; status: string; last_error: string | null; created_at: Date }[]>`
    SELECT id, provider, account_email, status, last_error, created_at FROM integrations WHERE tenant_id = ${tenantId} ORDER BY created_at`;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Integrations</h1>
        <p className="page-sub">Connect your calendar so agents can check availability and book appointments during calls.</p>
      </div>

      {typeof sp.connected === "string" && (
        <div className="rounded-lg border border-good/40 bg-good/5 p-3 text-sm">✓ Connected. Turn on booking for an agent under its Tools tab.</div>
      )}
      {typeof sp.error === "string" && (
        <div className="rounded-lg border border-critical/40 bg-critical/5 p-3 text-sm">▲ {ERRORS[sp.error] ?? "Something went wrong."}</div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {PROVIDERS.map((p) => {
          const mine = connections.filter((c) => c.provider === p.id);
          const available = isConfigured(p.id);
          return (
            <section key={p.id} className="card flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border text-lg font-semibold">{p.logo}</span>
                <div>
                  <h2 className="font-medium">{p.name}</h2>
                  <p className="text-sm text-muted">{p.blurb}</p>
                </div>
              </div>
              {mine.length > 0 && (
                <ul className="space-y-2">
                  {mine.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2 text-sm">
                      <span>
                        <span className={c.status === "connected" ? "text-good" : "text-critical"} aria-hidden>{c.status === "connected" ? "● " : "▲ "}</span>
                        {c.account_email}
                        <span className="block text-xs text-muted">
                          {c.status === "connected" ? `Connected ${formatDateTime(c.created_at)}` : "Needs reconnecting"}
                        </span>
                      </span>
                      <form action={disconnectIntegration}>
                        <input type="hidden" name="id" value={c.id} />
                        <button className="text-xs text-muted underline hover:text-critical">Disconnect</button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-auto">
                {available ? (
                  <a className={mine.length ? "btn-secondary" : "btn"} href={`/api/oauth/${p.id}/start?purpose=connect`}>
                    {mine.length ? "Connect another account" : `Connect ${p.name.split(" ")[0]}`}
                  </a>
                ) : (
                  <p className="text-xs text-muted">Not available yet: the platform owner needs to add {p.id === "google" ? "Google" : "Microsoft"} sign-in keys.</p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <section className="card">
        <h2 className="font-medium">Your own systems</h2>
        <p className="mt-1 text-sm text-muted">
          Connect anything else (a CRM, order system, booking software or Zapier/Make/n8n) as a <strong>custom function</strong> or an{" "}
          <strong>MCP server</strong> on an agent&apos;s Tools tab. The agent calls it during the call and uses the answer.
        </p>
        <Link href="/agents" className="mt-3 inline-block text-sm underline">Go to agents</Link>
      </section>
    </div>
  );
}

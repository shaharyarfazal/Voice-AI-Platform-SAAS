import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyButton } from "@/components/copy-button";
import { requireSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { workspaceUrl } from "@/lib/urls";
import { isUuid } from "@/lib/validation";
import { AppearanceSchema, type Widget } from "@/lib/widgets";
import { deleteWidget, rotateWidgetKey } from "../actions";
import { WidgetForm } from "../widget-form";
import { PreviewButton } from "./preview";

export default async function WidgetPage({ params }: PageProps<"/widgets/[id]">) {
  const { tenantId } = await requireSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [[w], agents] = await Promise.all([
    sql<Widget[]>`SELECT * FROM widgets WHERE id = ${id} AND tenant_id = ${tenantId}`,
    sql<{ id: string; name: string; type: string }[]>`SELECT id, name, type FROM agents WHERE tenant_id = ${tenantId} ORDER BY created_at`,
  ]);
  if (!w) notFound();
  const base = await workspaceUrl(tenantId);
  const embed = `<script src="${base}/widget.js" data-widget="${w.public_key}" async></script>`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/widgets" className="text-sm text-muted hover:underline">← Widgets</Link>
          <h1 className="page-title mt-1">{w.name}</h1>
        </div>
        <form action={deleteWidget}>
          <input type="hidden" name="id" value={w.id} />
          <button className="text-sm text-muted underline hover:text-critical">Delete widget</button>
        </form>
      </div>

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">Embed code</h2>
        <p className="text-sm text-muted">Paste this just before <code>&lt;/body&gt;</code> on every page where the widget should appear (or in your site builder&apos;s &ldquo;custom code&rdquo; box).</p>
        <pre className="overflow-x-auto rounded-lg bg-surface p-3 text-xs"><code>{embed}</code></pre>
        <div className="flex flex-wrap items-center gap-3">
          <CopyButton value={embed} label="Copy embed code" className="btn" />
          <PreviewButton src={`${base}/widget.js`} publicKey={w.public_key} />
          <form action={rotateWidgetKey}>
            <input type="hidden" name="id" value={w.id} />
            <button className="text-sm text-muted underline">New key (old embed code stops working)</button>
          </form>
        </div>
        <p className="text-xs text-muted">
          The key in this code is public by design. It only lets visitors chat or call this widget&apos;s agent, from the websites listed
          below, within rate limits. Your API keys never go in a website.
        </p>
      </section>

      <WidgetForm
        id={w.id}
        agents={agents}
        initial={{
          name: w.name,
          agentId: w.agent_id,
          mode: w.mode,
          enabled: w.enabled,
          origins: w.allowed_origins.join("\n"),
          appearance: AppearanceSchema.parse(w.appearance ?? {}),
        }}
      />
    </div>
  );
}

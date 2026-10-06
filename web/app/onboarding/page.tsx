import { redirect } from "next/navigation";
import { hasRole, requireSession } from "@/lib/auth";
import { LANGUAGES } from "@/lib/catalog";
import { sql } from "@/lib/db";
import { brandingFor, listWorkspaces } from "@/lib/workspace";
import { switchWorkspace } from "../(app)/settings/actions";
import { finish } from "./actions";
import { Wizard } from "./wizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await requireSession();
  const [t] = await sql<{ name: string; website: string | null; profile: Record<string, string>; onboarded_at: Date | null }[]>`
    SELECT name, website, profile, onboarded_at FROM tenants WHERE id = ${session.tenantId}`;
  if (t.onboarded_at || !hasRole(session, "admin")) redirect("/");
  const [brand, workspaces] = await Promise.all([brandingFor(session.tenantId), listWorkspaces(session.userId)]);
  const others = workspaces.filter((w) => w.id !== session.tenantId);
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10" style={brand.accentColor ? ({ "--accent": brand.accentColor } as React.CSSProperties) : undefined}>
      <div className="mb-8 flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {brand.logoUrl && <img src={brand.logoUrl} alt="" className="h-7 w-7 rounded object-contain" />}
        <span className="font-semibold">{brand.productName}</span>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
          {others.length > 0 && (
            <form action={switchWorkspace} className="flex items-center gap-2">
              <select name="tenantId" className="input w-auto py-1" aria-label="Switch workspace" defaultValue="">
                <option value="" disabled>Switch workspace…</option>
                {others.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <button className="text-muted underline">Go</button>
            </form>
          )}
          <form action={finish}>
            <button className="text-muted underline" title="Creates the three agents from the templates, without knowledge">Skip setup</button>
          </form>
        </div>
      </div>
      <Wizard
        initial={{
          name: t.name,
          website: t.website ?? "",
          industry: t.profile.industry ?? "",
          phone: t.profile.phone ?? "",
          language: t.profile.language ?? "en-US",
        }}
        languages={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
      />
    </main>
  );
}

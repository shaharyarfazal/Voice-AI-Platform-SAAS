import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSession, hasRole, requireSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { brandingFor, listWorkspaces } from "@/lib/workspace";
import { logout } from "../(auth)/actions";
import { Nav } from "./nav";
import { WorkspaceSwitcher } from "./workspace-switcher";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();
  const [[tenant], [user], admin, brand, workspaces] = await Promise.all([
    sql<{ name: string; status: string; onboarded_at: Date | null }[]>`SELECT name, status, onboarded_at FROM tenants WHERE id = ${session.tenantId}`,
    sql<{ email: string; name: string }[]>`SELECT email, name FROM users WHERE id = ${session.userId}`,
    getAdminSession(),
    brandingFor(session.tenantId),
    listWorkspaces(session.userId),
  ]);
  // New workspaces start with the setup wizard.
  if (tenant && !tenant.onboarded_at && hasRole(session, "admin")) redirect("/onboarding");

  return (
    <div className="flex flex-1 flex-col md:flex-row" style={brand.accentColor ? ({ "--accent": brand.accentColor } as React.CSSProperties) : undefined}>
      <aside className="border-b border-border bg-surface md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col md:border-r md:border-b-0">
        <div className="flex items-center gap-2 px-4 pt-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {brand.logoUrl && <img src={brand.logoUrl} alt="" className="h-6 w-6 rounded object-contain" />}
          <Link href="/" className="truncate text-sm font-semibold">{brand.productName}</Link>
        </div>
        <div className="px-2 py-3">
          <WorkspaceSwitcher current={{ id: session.tenantId, name: tenant?.name ?? "Workspace" }} workspaces={workspaces} />
        </div>
        <div className="px-2 pb-2 md:flex-1 md:overflow-y-auto">
          <Nav />
        </div>
        <div className="hidden space-y-1 border-t border-border p-2 md:block">
          {admin && <Link href="/admin" className="nav-link font-medium text-accent">Admin panel</Link>}
          <div className="truncate px-3 pt-1 text-xs text-muted" title={user?.email}>{user?.name || user?.email}</div>
          <form action={logout}>
            <button className="nav-link w-full">Sign out</button>
          </form>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {tenant?.status === "suspended" && (
          <div className="bg-critical px-4 py-2 text-center text-sm text-white">
            This account is suspended and calls are not being answered. Contact support{brand.supportEmail ? ` at ${brand.supportEmail}` : ""} to restore it.
          </div>
        )}
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 md:px-8">{children}</main>
        <div className="flex justify-end gap-4 border-t border-border px-4 py-3 text-sm md:hidden">
          {admin && <Link href="/admin" className="text-accent">Admin panel</Link>}
          <form action={logout}><button className="text-muted">Sign out</button></form>
        </div>
      </div>
    </div>
  );
}

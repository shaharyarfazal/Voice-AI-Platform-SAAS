import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { brandModule } from "@/brands";
import { Icon } from "@/components/icons";
import { getAdminSession, hasRole, requireSession } from "@/lib/auth";
import { currentBrand } from "@/lib/brand";
import { fromMilli, total } from "@/lib/billing/credits-math";
import { walletFor } from "@/lib/billing/wallet";
import { sql } from "@/lib/db";
import { brandingFor, listWorkspaces } from "@/lib/workspace";
import { logout } from "../(auth)/actions";
import { MobileShell, Nav } from "./nav";
import { WorkspaceSwitcher } from "./workspace-switcher";

// The dashboard is private: keep it out of search results. Marketing pages live on each brand's site.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Credits below this show a warning in the sidebar and across the top of every page. */
const LOW_CREDITS = 10;

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();
  const [[tenant], [user], admin, brand, workspaces, wallet] = await Promise.all([
    sql<{ name: string; status: string; onboarded_at: Date | null }[]>`SELECT name, status, onboarded_at FROM tenants WHERE id = ${session.tenantId}`,
    sql<{ email: string; name: string }[]>`SELECT email, name FROM users WHERE id = ${session.userId}`,
    getAdminSession(),
    brandingFor(session.tenantId),
    listWorkspaces(session.userId),
    walletFor(session.tenantId),
  ]);
  // New workspaces start with the setup wizard.
  if (tenant && !tenant.onboarded_at && hasRole(session, "admin")) redirect("/onboarding");

  const balance = wallet && wallet.mode !== "manual" ? fromMilli(total(wallet.balances)) : null;
  const canBuy = hasRole(session, "admin") && wallet?.tenantId === session.tenantId;
  const brandMark = (
    <Link href="/" className="flex min-w-0 items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {brand.logoUrl && <img src={brand.logoUrl} alt="" className="h-6 w-6 shrink-0 rounded object-contain" />}
      <span className="truncate">{brand.productName}</span>
    </Link>
  );

  return (
    <div className="flex flex-1 flex-col md:flex-row" style={brand.accentColor ? ({ "--accent": brand.accentColor } as React.CSSProperties) : undefined}>
      <MobileShell title={brandMark}>
        <div className="flex items-center gap-2 px-4 pt-4 pr-12 text-sm font-semibold md:pr-4">{brandMark}</div>
        <div className="px-2 py-3">
          <WorkspaceSwitcher current={{ id: session.tenantId, name: tenant?.name ?? "Workspace" }} workspaces={workspaces} />
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          <Nav extra={brandModule(currentBrand()).nav} />
        </div>
        <div className="space-y-1 border-t border-border p-2">
          {balance !== null && (
            <Link
              href="/billing"
              className={`flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm transition hover:bg-black/5 dark:hover:bg-white/10 ${balance < LOW_CREDITS ? "text-critical" : ""}`}
            >
              <span className="flex items-center gap-2"><Icon name="coins" /> Credits</span>
              <span className="font-semibold tabular-nums">{balance.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
            </Link>
          )}
          {admin && <Link href="/admin" className="nav-link font-medium text-accent"><Icon name="admin" /> Admin panel</Link>}
          <div className="truncate px-3 pt-1 text-xs text-muted" title={user?.email}>{user?.name || user?.email}</div>
          <form action={logout}>
            <button className="nav-link w-full"><Icon name="logout" /> Sign out</button>
          </form>
        </div>
      </MobileShell>
      <div className="flex min-w-0 flex-1 flex-col">
        {tenant?.status === "suspended" && (
          <div role="alert" className="bg-critical px-4 py-2 text-center text-sm text-white">
            This account is suspended and calls are not being answered. Contact support{brand.supportEmail ? ` at ${brand.supportEmail}` : ""} to restore it.
          </div>
        )}
        {tenant?.status !== "suspended" && balance !== null && balance < LOW_CREDITS && (
          <div role={balance <= 0 ? "alert" : "status"} className={`px-4 py-2 text-center text-sm ${balance <= 0 ? "bg-critical text-white" : "bg-critical/10"}`}>
            {balance <= 0 ? "You're out of credits — your agents have stopped answering. " : `Only ${Math.floor(balance)} credits left. `}
            {canBuy ? <Link href="/billing#buy" className="font-medium underline">Add credits</Link> : "Ask a workspace admin to add credits."}
          </div>
        )}
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

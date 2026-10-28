import type { Metadata } from "next";
import { cookies } from "next/headers";
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
import { MobileShell, Nav, RAIL_COOKIE } from "./nav";
import { WorkspaceSwitcher } from "./workspace-switcher";

// The dashboard is private: keep it out of search results. Marketing pages live on each brand's site.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Credits below this show a warning in the sidebar and across the top of every page. */
const LOW_CREDITS = 10;

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();
  const [[tenant], [user], admin, brand, workspaces, wallet, cookieStore] = await Promise.all([
    sql<{ name: string; status: string; onboarded_at: Date | null }[]>`SELECT name, status, onboarded_at FROM tenants WHERE id = ${session.tenantId}`,
    sql<{ email: string; name: string }[]>`SELECT email, name FROM users WHERE id = ${session.userId}`,
    getAdminSession(),
    brandingFor(session.tenantId),
    listWorkspaces(session.userId),
    walletFor(session.tenantId),
    cookies(),
  ]);
  // New workspaces start with the setup wizard.
  if (tenant && !tenant.onboarded_at && hasRole(session, "admin")) redirect("/onboarding");

  const balance = wallet && wallet.mode !== "manual" ? fromMilli(total(wallet.balances)) : null;
  const canBuy = hasRole(session, "admin") && wallet?.tenantId === session.tenantId;
  const initials = (user?.name || user?.email || "?").split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  const brandStyle = brand.accentColor ? ({ "--accent": brand.accentColor, "--on-accent": "#ffffff" } as React.CSSProperties) : undefined;
  const brandMark = (
    <Link href="/" className="rail-item flex min-w-0 items-center gap-3" data-tip={brand.productName}>
      {brand.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logoUrl} alt="" className="h-11 w-11 shrink-0 rounded-full bg-card object-contain p-1.5" />
      ) : (
        <span aria-hidden className="grid h-11 w-11 shrink-0 grid-cols-2 gap-[3px] rounded-full bg-accent p-3">
          {[0, 1, 2, 3].map((i) => <span key={i} className={`rounded-[2px] ${i === 1 ? "bg-lime" : "bg-on-accent"}`} />)}
        </span>
      )}
      <span className="rail-label truncate font-semibold">{brand.productName}</span>
    </Link>
  );

  return (
    <div className="flex flex-1 flex-col md:flex-row md:p-3" style={brandStyle}>
      <MobileShell title={brand.productName} initialCollapsed={cookieStore.get(RAIL_COOKIE)?.value !== "expanded"}>
        <div className="flex items-center px-4 pt-4 pb-5 pr-14 md:px-3 md:pt-3 md:pr-3">{brandMark}</div>
        <div className="px-3 pb-3 md:hidden">
          <WorkspaceSwitcher current={{ id: session.tenantId, name: tenant?.name ?? "Workspace" }} workspaces={workspaces} />
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-2 [scrollbar-width:none]">
          <Nav extra={brandModule(currentBrand()).nav} />
        </div>
        <div className="space-y-1 px-3 pt-2 md:pb-1">
          {balance !== null && (
            <Link href="/billing" className={`nav-link justify-between md:hidden ${balance < LOW_CREDITS ? "text-critical" : ""}`}>
              <span className="flex items-center gap-3"><Icon name="coins" className="h-[18px] w-[18px]" /> Credits</span>
              <span className="font-semibold tabular-nums">{balance.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
            </Link>
          )}
          {admin && <Link href="/admin" className="nav-link rail-item" data-tip="Admin panel"><Icon name="admin" className="h-[18px] w-[18px] shrink-0" /><span className="rail-label">Admin panel</span></Link>}
          <form action={logout}>
            <button className="nav-link rail-item w-full" data-tip="Sign out"><Icon name="logout" className="h-[18px] w-[18px] shrink-0" /><span className="rail-label">Sign out</span></button>
          </form>
        </div>
      </MobileShell>
      <div className="flex min-w-0 flex-1 flex-col md:min-h-[calc(100vh-1.5rem)] md:rounded-[32px] md:bg-background md:shadow-soft">
        {tenant?.status === "suspended" && (
          <div role="alert" className="bg-critical px-4 py-2 text-center text-sm text-white md:rounded-t-[32px]">
            This account is suspended and calls are not being answered. Contact support{brand.supportEmail ? ` at ${brand.supportEmail}` : ""} to restore it.
          </div>
        )}
        {tenant?.status !== "suspended" && balance !== null && balance < LOW_CREDITS && (
          <div role={balance <= 0 ? "alert" : "status"} className={`px-4 py-2 text-center text-sm md:rounded-t-[32px] ${balance <= 0 ? "bg-critical text-white" : "bg-critical/10"}`}>
            {balance <= 0 ? "You're out of credits — your agents have stopped answering. " : `Only ${Math.floor(balance)} credits left. `}
            {canBuy ? <Link href="/billing#buy" className="font-medium underline">Add credits</Link> : "Ask a workspace admin to add credits."}
          </div>
        )}
        <header className="hidden items-center justify-between gap-4 px-8 pt-6 md:flex">
          <div className="w-64">
            <WorkspaceSwitcher current={{ id: session.tenantId, name: tenant?.name ?? "Workspace" }} workspaces={workspaces} />
          </div>
          <div className="flex items-center gap-2">
            {balance !== null && (
              <Link href="/billing" className={`btn-secondary py-2 pr-4 pl-2 ${balance < LOW_CREDITS ? "text-critical" : ""}`} title="Credit balance">
                <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-full bg-lime text-on-lime"><Icon name="coins" className="h-4 w-4" /></span>
                <span className="font-semibold tabular-nums">{balance.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
                <span className="text-muted">credits</span>
              </Link>
            )}
            <Link href="/agents/new" className="btn py-2"><Icon name="plus" /> New agent</Link>
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-sm font-semibold" title={user?.email} aria-label={`Signed in as ${user?.name || user?.email}`}>{initials}</span>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

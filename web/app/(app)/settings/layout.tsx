import { SubNav } from "@/components/sub-nav";
import { hasRole, requireSession } from "@/lib/auth";
import { isTopLevel } from "@/lib/workspace";

export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const session = await requireSession();
  const admin = hasRole(session, "admin");
  const topLevel = await isTopLevel(session.tenantId);
  const items = [
    { href: "/settings", label: "Workspace" },
    ...(admin ? [{ href: "/settings/team", label: "Team" }, { href: "/settings/api-keys", label: "API keys" }] : []),
    ...(admin && topLevel ? [{ href: "/settings/sub-accounts", label: "Sub-accounts" }, { href: "/settings/branding", label: "White label" }] : []),
  ];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Settings</h1>
        <p className="page-sub">Your workspace, team, API access{topLevel ? ", client sub-accounts and branding" : ""}.</p>
      </div>
      <SubNav items={items} />
      {children}
    </div>
  );
}

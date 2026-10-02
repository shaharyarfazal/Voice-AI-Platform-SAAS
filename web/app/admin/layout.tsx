import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { logout } from "../(auth)/actions";

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/tenants", label: "Clients" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/calls", label: "Calls" },
  { href: "/admin/billing", label: "Billing" },
  { href: "/admin/system", label: "System" },
  { href: "/admin/settings", label: "Settings" },
];

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const admin = await requireAdmin();
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border bg-black/[0.02] dark:bg-white/[0.03]">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm">
          <span className="rounded bg-foreground px-2 py-0.5 text-xs font-semibold text-background">ADMIN</span>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="text-muted hover:text-foreground">{n.label}</Link>
          ))}
          <span className="ml-auto hidden text-xs text-muted sm:inline">{admin.email}</span>
          <Link href="/" className="text-muted hover:text-foreground">My dashboard</Link>
          <form action={logout}>
            <button className="text-muted hover:text-foreground">Sign out</button>
          </form>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}

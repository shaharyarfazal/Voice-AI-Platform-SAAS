import Link from "next/link";
import { getAdminSession, requireSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { logout } from "../(auth)/actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();
  const [[tenant], admin] = await Promise.all([
    sql`SELECT name, status FROM tenants WHERE id = ${session.tenantId}`,
    getAdminSession(),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border">
        <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
          <Link href="/" className="font-semibold">{tenant?.name ?? "Dashboard"}</Link>
          <Link href="/agents" className="text-muted hover:text-foreground">Agents</Link>
          <Link href="/numbers" className="text-muted hover:text-foreground">Phone numbers</Link>
          <Link href="/calls" className="text-muted hover:text-foreground">Calls</Link>
          {admin && <Link href="/admin" className="ml-auto font-medium text-blue-600">Admin panel</Link>}
          <form action={logout} className={admin ? "" : "ml-auto"}>
            <button className="text-muted hover:text-foreground">Sign out</button>
          </form>
        </nav>
      </header>
      {tenant?.status === "suspended" && (
        <div className="bg-red-600 px-4 py-2 text-center text-sm text-white">
          This account is suspended and calls are not being answered. Contact support to restore it.
        </div>
      )}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}

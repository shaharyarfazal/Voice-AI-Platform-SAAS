import Link from "next/link";
import { getAdminSession, requireSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { logout } from "../(auth)/actions";
import { Nav } from "./nav";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();
  const [[tenant], [user], admin] = await Promise.all([
    sql`SELECT name, status FROM tenants WHERE id = ${session.tenantId}`,
    sql`SELECT email FROM users WHERE id = ${session.userId}`,
    getAdminSession(),
  ]);

  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <aside className="border-b border-border bg-surface md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-4 py-4 md:block">
          <Link href="/" className="block truncate text-base font-semibold">{tenant?.name ?? "Dashboard"}</Link>
          <span className="hidden truncate text-xs text-muted md:block">{user?.email}</span>
        </div>
        <div className="px-2 pb-2 md:flex-1">
          <Nav />
        </div>
        <div className="hidden space-y-1 border-t border-border p-2 md:block">
          {admin && <Link href="/admin" className="nav-link font-medium text-accent">Admin panel</Link>}
          <form action={logout}>
            <button className="nav-link w-full">Sign out</button>
          </form>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {tenant?.status === "suspended" && (
          <div className="bg-critical px-4 py-2 text-center text-sm text-white">
            This account is suspended and calls are not being answered. Contact support to restore it.
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

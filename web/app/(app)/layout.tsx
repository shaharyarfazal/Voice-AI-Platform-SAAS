import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { logout } from "../(auth)/actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();
  const [tenant] = await sql`SELECT name FROM tenants WHERE id = ${session.tenantId}`;

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border">
        <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
          <Link href="/" className="font-semibold">{tenant?.name ?? "Dashboard"}</Link>
          <Link href="/agents" className="text-muted hover:text-foreground">Agents</Link>
          <Link href="/numbers" className="text-muted hover:text-foreground">Phone numbers</Link>
          <Link href="/calls" className="text-muted hover:text-foreground">Calls</Link>
          <form action={logout} className="ml-auto">
            <button className="text-muted hover:text-foreground">Sign out</button>
          </form>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}

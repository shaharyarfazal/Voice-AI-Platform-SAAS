import Link from "next/link";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { brandingFor } from "@/lib/workspace";
import { logout } from "../../(auth)/actions";
import { acceptInvite, findInvite } from "./actions";
import { NewUserForm } from "./new-user-form";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const invite = await findInvite(token);
  if (!invite) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
        <h1 className="text-2xl font-semibold">This invite isn&apos;t valid</h1>
        <p className="mt-2 text-sm text-muted">It may have expired or already been used. Ask whoever invited you for a new link.</p>
        <Link href="/login" className="btn mt-6 w-fit">Sign in</Link>
      </main>
    );
  }
  const brand = await brandingFor(invite.tenant_id);
  const session = await getSession();
  const [me] = session ? await sql<{ email: string }[]>`SELECT email FROM users WHERE id = ${session.userId}` : [];
  const [existing] = await sql`SELECT 1 FROM users WHERE email = ${invite.email}`;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
      <div className="mb-6 flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {brand.logoUrl && <img src={brand.logoUrl} alt="" className="h-8 w-8 rounded object-contain" />}
        <span className="font-semibold">{brand.productName}</span>
      </div>
      <h1 className="text-2xl font-semibold">Join {invite.workspace}</h1>
      <p className="mt-2 text-sm text-muted">
        You&apos;ve been invited as {invite.role === "admin" ? "an admin" : "a member"} ({invite.email}).
      </p>
      <div className="mt-6">
        {me?.email === invite.email ? (
          <form action={acceptInvite.bind(null, token)}>
            <button className="btn w-full">Accept and open the workspace</button>
          </form>
        ) : me ? (
          <div className="space-y-3 text-sm">
            <p>You&apos;re signed in as {me.email}, but this invite is for {invite.email}.</p>
            <form action={logout}><button className="btn-secondary">Sign out and switch account</button></form>
          </div>
        ) : existing ? (
          <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} className="btn w-full">Sign in to accept</Link>
        ) : (
          <NewUserForm token={token} email={invite.email} />
        )}
      </div>
    </main>
  );
}

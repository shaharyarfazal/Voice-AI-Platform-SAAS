import { brandingForHost } from "@/lib/workspace";

// Public page for team members connecting their own calendar from an invite link, and the result
// after they approve access.
export default async function ConnectCalendarPage({ searchParams }: PageProps<"/connect-calendar">) {
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const invite = one(q.invite);
  const provider = one(q.provider) || "google";
  const connected = one(q.connected);
  const error = one(q.error);
  const brand = await brandingForHost();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 px-4 py-12">
      <div className="text-sm font-semibold text-muted">{brand.productName}</div>
      {connected ? (
        <div className="card space-y-2">
          <h1 className="text-xl font-semibold">Calendar connected</h1>
          <p className="text-sm text-muted">
            {one(q.name) ? `${one(q.name)}, your` : "Your"} calendar ({connected}) is connected. New jobs will appear in it, and
            anything already in it keeps that time free. You can close this page.
          </p>
        </div>
      ) : error ? (
        <div className="card space-y-2">
          <h1 className="text-xl font-semibold">Not connected</h1>
          <p className="text-sm text-critical">{error}</p>
          {invite && <a className="btn" href={`/api/schedule-oauth/${provider}/start?invite=${encodeURIComponent(invite)}`}>Try again</a>}
        </div>
      ) : invite ? (
        <div className="card space-y-4">
          <h1 className="text-xl font-semibold">Connect your calendar</h1>
          <p className="text-sm text-muted">
            Your jobs will be added to your calendar automatically, and you won&apos;t be booked when your calendar says
            you&apos;re busy. Only the times you&apos;re busy are kept; your events&apos; titles and details are never stored.
          </p>
          <a className="btn w-full" href={`/api/schedule-oauth/${provider}/start?invite=${encodeURIComponent(invite)}`}>
            Connect Google Calendar
          </a>
        </div>
      ) : (
        <p className="card text-sm text-muted">This link is incomplete. Ask for a new one.</p>
      )}
    </main>
  );
}

import { hasRole, requireSession } from "@/lib/auth";
import { walletFor } from "@/lib/billing/wallet";
import { sql } from "@/lib/db";
import { canBuyNumbers, numberPrice } from "@/lib/phone-numbers";
import { SELL_COUNTRIES, twilioStatus } from "@/lib/twilio";
import { assignAgent, removeNumber } from "./actions";
import { BuyNumber, ConnectOwnNumber } from "./add-number-form";

type NumberRow = { id: string; e164: string; carrier: string; agent_id: string | null; source: "platform" | "byo"; status: "pending" | "active" | "past_due"; paid_until: Date | null };

const CARRIERS: Record<string, string> = { twilio: "Twilio", telnyx: "Telnyx", other: "Other" };

export default async function NumbersPage() {
  const session = await requireSession();
  const { tenantId } = session;
  const [numbers, agents, wallet] = await Promise.all([
    // Unfinished verifications that have expired are hidden; they're cleared when someone claims the number.
    sql<NumberRow[]>`
      SELECT id, e164, carrier, agent_id, source, status, paid_until FROM phone_numbers
      WHERE tenant_id = ${tenantId} AND NOT (status = 'pending' AND verify_expires_at < now()) ORDER BY created_at`,
    sql<{ id: string; name: string }[]>`SELECT id, name FROM agents WHERE tenant_id = ${tenantId} AND type <> 'chat' ORDER BY name`,
    walletFor(tenantId),
  ]);
  const twilio = twilioStatus();
  const admin = hasRole(session, "admin");
  const price = numberPrice(wallet?.brand ?? "default");
  const subscribed = canBuyNumbers(wallet);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Phone numbers</h1>
        <p className="mt-1 text-sm text-muted">Buy a number that works straight away, or connect one you already have. Calls to a number are answered by the agent you choose.</p>
      </div>
      {numbers.length > 0 && (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Type</th>
                <th>Answered by</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {numbers.map((n) => (
                <tr key={n.id}>
                  <td className="font-mono">
                    {n.e164}
                    {n.status === "pending" && <span className="badge ml-2">Waiting for verification</span>}
                    {n.status === "past_due" && <span className="badge ml-2 text-critical">{subscribed ? "Payment due: add credits to keep it" : "Payment due: start a plan to keep it"}</span>}
                  </td>
                  <td className="text-sm">
                    {n.source === "platform" ? `Bought here · ${price.label}${n.paid_until ? ` · renews ${n.paid_until.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : ""}` : `Your number · ${CARRIERS[n.carrier] ?? n.carrier}`}
                  </td>
                  <td>
                    <form action={assignAgent} className="flex gap-2">
                      <input type="hidden" name="id" value={n.id} />
                      <select className="input max-w-56" name="agentId" defaultValue={n.agent_id ?? ""}>
                        <option value="">Nobody</option>
                        {agents.map((a) => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                      <button className="btn-secondary">Save</button>
                    </form>
                  </td>
                  <td className="text-right">
                    {admin && (
                      <form action={removeNumber}>
                        <input type="hidden" name="id" value={n.id} />
                        <button className="text-sm text-critical hover:underline" title={n.source === "platform" ? "The number is released and billing stops. It can't be got back." : undefined}>
                          {n.source === "platform" ? "Release" : "Remove"}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!admin ? (
        <p className="text-sm text-muted">Ask a workspace admin to add phone numbers.</p>
      ) : (
        <>
          {twilio.sell && <BuyNumber agents={agents} price={price} countries={SELL_COUNTRIES} subscribed={subscribed} />}
          {twilio.verify ? (
            <ConnectOwnNumber agents={agents} sipHost={process.env.SIP_INBOUND_HOST || null} />
          ) : (
            <div className="card text-sm text-muted">Adding phone numbers isn&apos;t available on this platform yet.</div>
          )}
        </>
      )}
    </div>
  );
}

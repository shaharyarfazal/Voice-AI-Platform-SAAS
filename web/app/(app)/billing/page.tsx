import type { Metadata } from "next";
import Link from "next/link";
import { hasRole, requireSession } from "@/lib/auth";
import { catalogFor, findPack, findPlan, formatMoney } from "@/lib/billing/catalog";
import { fromMilli, total } from "@/lib/billing/credits-math";
import { fulfilCheckoutSession, stripe, stripeConfigured } from "@/lib/billing/stripe";
import { ledger, spentThisMonth, walletFor, type LedgerRow } from "@/lib/billing/wallet";
import { formatDateTime } from "@/lib/format";
import { brandingFor } from "@/lib/workspace";
import { openBillingPortal } from "./actions";
import { AutoRechargeForm, BuyPackButton, ChoosePlanButton } from "./forms";

export const metadata: Metadata = { title: "Billing" };

const credits = (milli: number) => fromMilli(milli).toLocaleString("en-US", { maximumFractionDigits: 1 });

const KIND_LABELS: Record<LedgerRow["kind"], string> = {
  trial: "Trial",
  purchase: "Purchase",
  auto_recharge: "Auto top-up",
  plan_renewal: "Plan",
  call: "Call",
  chat: "Chat",
  adjustment: "Adjustment",
  refund: "Refund",
  phone_number: "Phone number",
};

/** When the customer comes back from Checkout, credit them now instead of waiting for the webhook. */
async function confirmCheckout(sessionId: string | undefined, tenantId: string): Promise<"done" | "pending" | null> {
  if (!sessionId || !stripeConfigured()) return null;
  try {
    const session = await stripe().checkout.sessions.retrieve(sessionId);
    if (session.metadata?.tenant_id !== tenantId) return null;
    await fulfilCheckoutSession(session);
    return session.status === "complete" && session.payment_status !== "unpaid" ? "done" : "pending";
  } catch (e) {
    console.error("billing: could not confirm checkout", e);
    return "pending";
  }
}

export default async function BillingPage({ searchParams }: PageProps<"/billing">) {
  const session = await requireSession();
  const { checkout, session_id } = await searchParams;
  const canPay = hasRole(session, "admin");
  const confirmed = checkout === "success" ? await confirmCheckout(typeof session_id === "string" ? session_id : undefined, session.tenantId) : null;

  const [wallet, brand] = await Promise.all([walletFor(session.tenantId), brandingFor(session.tenantId)]);
  if (!wallet) return null;
  const managedByAgency = wallet.tenantId !== session.tenantId;

  if (wallet.mode === "manual") {
    return (
      <div className="space-y-6">
        <Header />
        <div className="card space-y-2">
          <h2 className="font-semibold">You&apos;re on an invoiced account</h2>
          <p className="text-sm text-muted">
            Usage is billed to you monthly{brand.supportEmail ? <> — questions go to <a className="underline" href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a></> : null}.
            See your minutes on the <Link className="underline" href="/calls">Calls</Link> page.
          </p>
        </div>
      </div>
    );
  }

  const catalog = catalogFor(wallet.brand);
  const balance = total(wallet.balances);
  const plan = findPlan(catalog, wallet.planId);
  const [entries, spent] = await Promise.all([
    ledger(wallet.tenantId, { limit: 50, usedBy: managedByAgency ? session.tenantId : undefined }),
    spentThisMonth(wallet.tenantId, managedByAgency ? session.tenantId : null),
  ]);
  const low = balance < 1000 * 10;
  const pastDue = wallet.subscriptionStatus === "past_due" || wallet.subscriptionStatus === "unpaid";
  const payable = canPay && !managedByAgency && stripeConfigured();
  const recharge = wallet.autoRecharge;
  const packLabel = (id: string) => {
    const p = findPack(catalog, id);
    return p ? `${p.credits.toLocaleString("en-US")} credits for ${formatMoney(p.priceCents, catalog.currency)}` : id;
  };

  return (
    <div className="space-y-8">
      <Header />

      {confirmed === "done" && <Banner tone="good">Payment received — thank you! Your credits are ready to use.</Banner>}
      {confirmed === "pending" && <Banner tone="neutral">Payment is processing. Your credits will appear here as soon as your bank confirms it.</Banner>}
      {checkout === "cancelled" && <Banner tone="neutral">Checkout was cancelled. You haven&apos;t been charged.</Banner>}
      {pastDue && (
        <Banner tone="critical">
          Your last plan payment failed. Update your card under <strong>Manage billing</strong> to keep your plan credits coming.
        </Banner>
      )}
      {balance <= 0 && (
        <Banner tone="critical">
          You&apos;re out of credits, so your agents aren&apos;t answering calls or chats. {payable ? "Buy credits below to turn them back on." : managedByAgency ? `Ask ${wallet.name} to add credits.` : "Ask a workspace admin to add credits."}
        </Banner>
      )}

      <section className="grid gap-4 md:grid-cols-3" aria-label="Balance">
        <div className="card md:col-span-2">
          <div className="text-sm text-muted">{managedByAgency ? `Shared balance, provided by ${wallet.name}` : "Credit balance"}</div>
          <div className={`mt-1 text-4xl font-semibold tabular-nums ${balance <= 0 ? "text-critical" : ""}`}>{credits(balance)}</div>
          <div className="mt-1 text-sm text-muted">
            About {Math.max(0, Math.floor(fromMilli(balance) / wallet.creditsPerMinute)).toLocaleString("en-US")} minutes of calls
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm">
            <div>
              <dt className="text-muted">From your plan</dt>
              <dd className="font-medium tabular-nums">
                {credits(wallet.balances.plan)}
                {wallet.currentPeriodEnd && <span className="font-normal text-muted"> · renews {wallet.currentPeriodEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Purchased</dt>
              <dd className="font-medium tabular-nums">{credits(wallet.balances.paid)} <span className="font-normal text-muted">· never expire</span></dd>
            </div>
          </dl>
          {payable && (
            <div className="mt-4 flex flex-wrap gap-2">
              <a href="#buy" className="btn">Buy credits</a>
              {wallet.stripeCustomerId && (
                <form action={openBillingPortal}>
                  <button className="btn-secondary">Manage billing</button>
                </form>
              )}
            </div>
          )}
        </div>
        <div className="card">
          <div className="text-sm text-muted">Used this month{managedByAgency ? " by this workspace" : ""}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{credits(spent)}</div>
          <div className="mt-4 text-sm text-muted">Current plan</div>
          <div className="font-medium">{plan ? plan.name : "No plan — pay as you go"}</div>
          {wallet.creditsPerMinute !== 1 && <div className="mt-2 text-xs text-muted">{wallet.creditsPerMinute} credits per call minute</div>}
          {low && balance > 0 && !recharge.enabled && payable && <p className="mt-3 text-sm text-critical">Running low — turn on auto top-up below.</p>}
        </div>
      </section>

      {!managedByAgency && catalog.plans.length > 0 && (
        <section className="space-y-3" aria-labelledby="plans">
          <div>
            <h2 id="plans" className="text-lg font-semibold">Monthly plans</h2>
            <p className="text-sm text-muted">Plan credits refill every month. Unused plan credits don&apos;t roll over; purchased credits always do.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {catalog.plans.map((p) => {
              const current = p.id === wallet.planId;
              return (
                <div key={p.id} className={`card flex flex-col ${p.highlighted ? "border-accent ring-1 ring-accent" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold">{p.name}</h3>
                    {current ? <span className="badge border-accent text-accent">Current</span> : p.highlighted ? <span className="badge">Most popular</span> : null}
                  </div>
                  <div className="mt-2">
                    <span className="text-3xl font-semibold tabular-nums">{formatMoney(p.priceCents, catalog.currency)}</span>
                    <span className="text-sm text-muted"> / month</span>
                  </div>
                  <p className="mt-1 text-sm text-muted">{p.description}</p>
                  <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                    {p.features.map((f) => (
                      <li key={f} className="flex gap-2"><span aria-hidden className="text-good">✓</span>{f}</li>
                    ))}
                  </ul>
                  {payable && (
                    <div className="mt-5">
                      <ChoosePlanButton planId={p.id} label={current ? "Current plan" : plan ? `Switch to ${p.name}` : `Choose ${p.name}`} primary={p.highlighted && !current} disabled={current} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {payable && (
        <section id="buy" className="grid scroll-mt-6 gap-6 md:grid-cols-2" aria-label="Buy credits">
          <div className="card space-y-3">
            <div>
              <h2 className="font-semibold">Buy credits</h2>
              <p className="text-sm text-muted">Pay securely on Stripe. Credits are added as soon as payment goes through.</p>
            </div>
            {catalog.packs.map((p) => (
              <BuyPackButton key={p.id} packId={p.id} label={`${p.credits.toLocaleString("en-US")} credits`} price={formatMoney(p.priceCents, catalog.currency)} />
            ))}
          </div>
          <div className="card space-y-3">
            <h2 className="font-semibold">Auto top-up</h2>
            <AutoRechargeForm
              enabled={Boolean(recharge.enabled)}
              thresholdCredits={recharge.thresholdCredits ?? 20}
              packId={recharge.packId ?? catalog.packs[0].id}
              packs={catalog.packs.map((p) => ({ id: p.id, label: packLabel(p.id) }))}
              lastError={recharge.lastError}
              canEnable={Boolean(wallet.stripeCustomerId)}
            />
          </div>
        </section>
      )}

      <section className="space-y-3" aria-labelledby="activity">
        <h2 id="activity" className="text-lg font-semibold">Activity</h2>
        {entries.length === 0 ? (
          <p className="text-sm text-muted">No credit activity yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>What</th>
                  {!managedByAgency && entries.some((e) => e.used_by_name) && <th>Client</th>}
                  <th className="text-right">Credits</th>
                  <th className="text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const change = Number(e.plan_delta_milli) + Number(e.paid_delta_milli);
                  return (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap text-muted">{formatDateTime(e.created_at)}</td>
                      <td>
                        <span className="badge mr-2">{KIND_LABELS[e.kind]}</span>
                        {e.description}
                      </td>
                      {!managedByAgency && entries.some((x) => x.used_by_name) && <td>{e.used_by_name ?? "—"}</td>}
                      <td className={`text-right tabular-nums ${change > 0 ? "text-good" : ""}`}>{change > 0 ? "+" : ""}{credits(change)}</td>
                      <td className="text-right tabular-nums text-muted">{credits(Number(e.plan_after_milli) + Number(e.paid_after_milli))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="page-title">Billing &amp; credits</h1>
      <p className="page-sub">One credit is one minute of calls. Chatbot replies use a fraction of a credit.</p>
    </div>
  );
}

function Banner({ tone, children }: { tone: "good" | "critical" | "neutral"; children: React.ReactNode }) {
  const styles = { good: "border-good/40 bg-good/10", critical: "border-critical/40 bg-critical/10", neutral: "border-border bg-surface" }[tone];
  return <div role={tone === "critical" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${styles}`}>{children}</div>;
}

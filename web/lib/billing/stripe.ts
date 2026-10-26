import "server-only";
import Stripe from "stripe";
import { sql } from "../db";
import { publicUrl } from "../oauth";
import { catalogFor, findPack, findPlan, type CreditPack, type Plan } from "./catalog";
import { needsRecharge, planReset, toMilli } from "./credits-math";
import { addPaidCredits, applyEntry, walletFor, type Wallet } from "./wallet";

// Payments go through Stripe-hosted pages only: Checkout for plans and credit packs, the Customer
// Portal for cards, invoices and cancelling. Card details never touch this app. Credits are granted
// from verified webhooks (and, as a fast path, when the customer returns from Checkout); both paths
// are idempotent through the ledger's (kind, ref) key.

let client: Stripe | undefined;

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function stripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not set");
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2, appInfo: { name: "voice-platform" } });
  return client;
}

/** The workspace's Stripe customer, created on first use. */
async function ensureCustomer(wallet: Wallet, email: string): Promise<string> {
  if (wallet.stripeCustomerId) return wallet.stripeCustomerId;
  const customer = await stripe().customers.create(
    { name: wallet.name, email, metadata: { tenant_id: wallet.tenantId, brand: wallet.brand } },
    // Two clicks at once must not create two customers.
    { idempotencyKey: `customer-${wallet.tenantId}` },
  );
  const [row] = await sql<{ stripe_customer_id: string }[]>`
    UPDATE tenants SET stripe_customer_id = coalesce(stripe_customer_id, ${customer.id}) WHERE id = ${wallet.tenantId}
    RETURNING stripe_customer_id`;
  return row.stripe_customer_id;
}

function billingUrl(query: string): string {
  return publicUrl(`/billing?${query}`).toString();
}

/** A Checkout page for a one-off credit pack. The card is saved for auto top-up. */
export async function creditPackCheckout(wallet: Wallet, pack: CreditPack, email: string): Promise<string> {
  const catalog = catalogFor(wallet.brand);
  const metadata = { tenant_id: wallet.tenantId, kind: "credit_pack", pack_id: pack.id, credits: String(pack.credits) };
  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    customer: await ensureCustomer(wallet, email),
    client_reference_id: wallet.tenantId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: catalog.currency,
          unit_amount: pack.priceCents,
          product_data: { name: `${pack.credits.toLocaleString("en-US")} credits`, metadata: { kind: "credit_pack" } },
        },
      },
    ],
    payment_intent_data: { setup_future_usage: "off_session", metadata },
    invoice_creation: { enabled: true },
    allow_promotion_codes: true,
    metadata,
    success_url: billingUrl("checkout=success&session_id={CHECKOUT_SESSION_ID}"),
    cancel_url: billingUrl("checkout=cancelled"),
  });
  return session.url!;
}

/** A Checkout page that starts a monthly plan. */
export async function planCheckout(wallet: Wallet, plan: Plan, email: string): Promise<string> {
  const catalog = catalogFor(wallet.brand);
  const metadata = { tenant_id: wallet.tenantId, kind: "plan", plan_id: plan.id };
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: await ensureCustomer(wallet, email),
    client_reference_id: wallet.tenantId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: catalog.currency,
          unit_amount: plan.priceCents,
          recurring: { interval: "month" },
          product_data: { name: `${plan.name} plan`, metadata: { kind: "plan", plan_id: plan.id } },
        },
      },
    ],
    subscription_data: { metadata },
    allow_promotion_codes: true,
    metadata,
    success_url: billingUrl("checkout=success&session_id={CHECKOUT_SESSION_ID}"),
    cancel_url: billingUrl("checkout=cancelled"),
  });
  return session.url!;
}

/**
 * Moves an active subscription to another plan. Upgrades are charged now (prorated) and the paid
 * invoice resets credits to the bigger allowance straight away; downgrades start at the next renewal.
 */
export async function changePlan(wallet: Wallet, subscriptionId: string, plan: Plan): Promise<"now" | "renewal"> {
  const catalog = catalogFor(wallet.brand);
  const current = findPlan(catalog, wallet.planId);
  const upgrade = !current || plan.priceCents > current.priceCents;
  const sub = await stripe().subscriptions.retrieve(subscriptionId);
  const item = sub.items.data[0];
  const product = await stripe().products.create({ name: `${plan.name} plan`, metadata: { kind: "plan", plan_id: plan.id } });
  await stripe().subscriptions.update(subscriptionId, {
    items: [{ id: item.id, price_data: { currency: catalog.currency, unit_amount: plan.priceCents, recurring: { interval: "month" }, product: product.id } }],
    metadata: { ...sub.metadata, plan_id: plan.id },
    proration_behavior: upgrade ? "always_invoice" : "none",
    payment_behavior: "error_if_incomplete",
  });
  return upgrade ? "now" : "renewal";
}

/** Stripe's Customer Portal: change card, download invoices, cancel the plan. */
export async function portalUrl(wallet: Wallet): Promise<string | null> {
  if (!wallet.stripeCustomerId) return null;
  const portal = await stripe().billingPortal.sessions.create({ customer: wallet.stripeCustomerId, return_url: billingUrl("from=portal") });
  return portal.url;
}

// ---- Fulfilment (called from the webhook and the Checkout return page) ----

async function tenantForMetadata(metadata: Stripe.Metadata | null | undefined, customer: string | Stripe.Customer | Stripe.DeletedCustomer | null): Promise<string | null> {
  if (metadata?.tenant_id) return metadata.tenant_id;
  const id = typeof customer === "string" ? customer : customer?.id;
  if (!id) return null;
  const [row] = await sql<{ id: string }[]>`SELECT id FROM tenants WHERE stripe_customer_id = ${id}`;
  return row?.id ?? null;
}

/** Makes the card used at Checkout the customer's default, so auto top-up can charge it. */
async function rememberPaymentMethod(paymentIntent: string | Stripe.PaymentIntent | null, customer: string | null): Promise<void> {
  if (!paymentIntent || !customer) return;
  const pi = typeof paymentIntent === "string" ? await stripe().paymentIntents.retrieve(paymentIntent) : paymentIntent;
  const pm = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id;
  if (pm) await stripe().customers.update(customer, { invoice_settings: { default_payment_method: pm } });
}

export async function fulfilCheckoutSession(session: Stripe.Checkout.Session): Promise<void> {
  const tenantId = await tenantForMetadata(session.metadata, session.customer);
  if (!tenantId) return;
  const customer = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
  if (customer) await sql`UPDATE tenants SET stripe_customer_id = coalesce(stripe_customer_id, ${customer}) WHERE id = ${tenantId}`;

  if (session.mode === "payment" && session.metadata?.kind === "credit_pack") {
    if (session.payment_status !== "paid") return; // delayed methods finish in async_payment_succeeded
    const credits = Number(session.metadata.credits);
    if (!(credits > 0)) return;
    await addPaidCredits(tenantId, credits, { kind: "purchase", ref: session.id, description: `Bought ${credits.toLocaleString("en-US")} credits` });
    await rememberPaymentMethod(session.payment_intent, customer).catch((e) => console.error("billing: could not save the card", e));
  }
  if (session.mode === "subscription" && session.subscription) {
    const sub = typeof session.subscription === "string" ? await stripe().subscriptions.retrieve(session.subscription) : session.subscription;
    await syncSubscription(sub);
  }
}

function periodEnd(sub: Stripe.Subscription): Date | null {
  const end = sub.items.data[0]?.current_period_end;
  return end ? new Date(end * 1000) : null;
}

export async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const tenantId = await tenantForMetadata(sub.metadata, sub.customer);
  if (!tenantId) return;
  const ended = sub.status === "canceled" || sub.status === "incomplete_expired";
  // Only the workspace's current subscription (or its first) may change its plan.
  const updated = await sql`
    UPDATE tenants SET
      stripe_subscription_id = ${ended ? null : sub.id},
      plan_id = ${ended ? null : sub.metadata.plan_id ?? null},
      subscription_status = ${sub.status},
      current_period_end = ${ended ? null : periodEnd(sub)},
      billing_mode = CASE WHEN billing_mode = 'manual' THEN 'credits' ELSE billing_mode END
    WHERE id = ${tenantId} AND (stripe_subscription_id IS NULL OR stripe_subscription_id = ${sub.id})
    RETURNING id`;
  if (ended && updated.length > 0) {
    // Leftover plan credits end with the plan; purchased credits stay.
    await applyEntry(tenantId, { kind: "plan_renewal", ref: `ended:${sub.id}`, description: "Plan ended" }, (b) => planReset(b, 0));
  }
}

/** A paid subscription invoice starts a new period: plan credits are reset to the plan's allowance. */
export async function fulfilInvoice(invoice: Stripe.Invoice): Promise<void> {
  const details = invoice.parent?.subscription_details;
  if (!details) return;
  const tenantId = await tenantForMetadata(details.metadata, invoice.customer);
  if (!tenantId) return;
  const [tenant] = await sql<{ brand: string }[]>`SELECT brand FROM tenants WHERE id = ${tenantId}`;
  const plan = findPlan(catalogFor(tenant?.brand), details.metadata?.plan_id);
  if (!plan) {
    console.error(`billing: invoice ${invoice.id} has unknown plan ${details.metadata?.plan_id}`);
    return;
  }
  await applyEntry(
    tenantId,
    { kind: "plan_renewal", ref: invoice.id!, description: `${plan.name} plan: ${plan.credits.toLocaleString("en-US")} credits` },
    (b) => planReset(b, toMilli(plan.credits)),
  );
}

// ---- Auto top-up ----

const RECHARGE_COOLDOWN_MINUTES = 10;

/**
 * Charges the saved card for the chosen pack when the balance falls below the threshold. A claim
 * on auto_recharge_at keeps concurrent call reports from charging twice.
 */
export async function maybeAutoRecharge(wallet: Wallet): Promise<void> {
  const ar = wallet.autoRecharge;
  if (!stripeConfigured() || wallet.mode !== "credits" || !ar.enabled || !wallet.stripeCustomerId) return;
  if (!needsRecharge(wallet.balances, ar.thresholdCredits ?? 0)) return;
  const pack = findPack(catalogFor(wallet.brand), ar.packId);
  if (!pack) return;

  const claimed = await sql`
    UPDATE tenants SET auto_recharge_at = now()
    WHERE id = ${wallet.tenantId}
      AND (auto_recharge_at IS NULL OR auto_recharge_at < now() - make_interval(mins => ${RECHARGE_COOLDOWN_MINUTES}))
    RETURNING id`;
  if (claimed.length === 0) return;

  const catalog = catalogFor(wallet.brand);
  try {
    const customer = (await stripe().customers.retrieve(wallet.stripeCustomerId)) as Stripe.Customer;
    const pm = customer.invoice_settings?.default_payment_method;
    const paymentMethod = typeof pm === "string" ? pm : pm?.id;
    if (!paymentMethod) throw new Error("No saved card. Buy credits once to save one.");
    const pi = await stripe().paymentIntents.create(
      {
        amount: pack.priceCents,
        currency: catalog.currency,
        customer: wallet.stripeCustomerId,
        payment_method: paymentMethod,
        off_session: true,
        confirm: true,
        description: `Auto top-up: ${pack.credits} credits`,
        metadata: { tenant_id: wallet.tenantId, kind: "auto_recharge", pack_id: pack.id, credits: String(pack.credits) },
      },
      { idempotencyKey: `recharge-${wallet.tenantId}-${Math.floor(Date.now() / (RECHARGE_COOLDOWN_MINUTES * 60_000))}` },
    );
    if (pi.status === "succeeded") await fulfilPaymentIntent(pi);
    await setRechargeError(wallet.tenantId, null);
  } catch (e) {
    const message = e instanceof Stripe.errors.StripeCardError ? e.message : e instanceof Error ? e.message : "Auto top-up failed";
    console.error(`billing: auto top-up failed for ${wallet.tenantId}`, e);
    await setRechargeError(wallet.tenantId, message);
  }
}

async function setRechargeError(tenantId: string, message: string | null): Promise<void> {
  await sql`
    UPDATE tenants SET auto_recharge = ${message ? sql`auto_recharge || ${sql.json({ lastError: message })}` : sql`auto_recharge - 'lastError'`}
    WHERE id = ${tenantId}`;
}

export async function fulfilPaymentIntent(pi: Stripe.PaymentIntent): Promise<void> {
  if (pi.metadata?.kind !== "auto_recharge" || pi.status !== "succeeded") return;
  const credits = Number(pi.metadata.credits);
  if (!pi.metadata.tenant_id || !(credits > 0)) return;
  await addPaidCredits(pi.metadata.tenant_id, credits, { kind: "auto_recharge", ref: pi.id, description: `Auto top-up: ${credits.toLocaleString("en-US")} credits` });
}

/** After usage: top up in the background if needed. Never throws. */
export async function afterSpend(tenantId: string): Promise<void> {
  try {
    const wallet = await walletFor(tenantId);
    if (wallet) await maybeAutoRecharge(wallet);
  } catch (e) {
    console.error("billing: after-spend check failed", e);
  }
}

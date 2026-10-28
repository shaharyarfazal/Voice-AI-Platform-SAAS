import "server-only";
import { sql } from "../db";
import { catalogFor } from "./catalog";
import { apply, callCostMilli, splitDebit, toMilli, total, type Balances, type Delta } from "./credits-math";

export type BillingMode = "credits" | "parent" | "manual";
export type LedgerKind = "trial" | "purchase" | "auto_recharge" | "plan_renewal" | "call" | "chat" | "adjustment" | "refund";

export type AutoRecharge = { enabled?: boolean; thresholdCredits?: number; packId?: string; lastError?: string };

export type Wallet = {
  /** The workspace that owns the balance: the workspace itself, or its agency in 'parent' mode. */
  tenantId: string;
  name: string;
  brand: string;
  mode: BillingMode;
  balances: Balances;
  creditsPerMinute: number;
  stripeCustomerId: string | null;
  planId: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: Date | null;
  autoRecharge: AutoRecharge;
};

type WalletRow = {
  id: string;
  name: string;
  brand: string;
  billing_mode: BillingMode;
  plan_credits_milli: string;
  paid_credits_milli: string;
  credits_per_minute: string;
  stripe_customer_id: string | null;
  plan_id: string | null;
  subscription_status: string | null;
  current_period_end: Date | null;
  auto_recharge: AutoRecharge;
};

function toWallet(r: WalletRow): Wallet {
  return {
    tenantId: r.id,
    name: r.name,
    brand: r.brand,
    mode: r.billing_mode,
    // bigint columns arrive as strings; balances stay far below 2^53 millicredits.
    balances: { plan: Number(r.plan_credits_milli), paid: Number(r.paid_credits_milli) },
    creditsPerMinute: Number(r.credits_per_minute),
    stripeCustomerId: r.stripe_customer_id,
    planId: r.plan_id,
    subscriptionStatus: r.subscription_status,
    currentPeriodEnd: r.current_period_end,
    autoRecharge: r.auto_recharge ?? {},
  };
}

const WALLET_COLUMNS = sql`id, name, brand, billing_mode, plan_credits_milli, paid_credits_milli, credits_per_minute,
  stripe_customer_id, plan_id, subscription_status, current_period_end, auto_recharge`;

/** The wallet a workspace spends from. A sub-account in 'parent' mode spends its agency's. */
export async function walletFor(tenantId: string): Promise<Wallet | null> {
  const [row] = await sql<WalletRow[]>`
    SELECT ${WALLET_COLUMNS} FROM tenants
    WHERE id = (SELECT CASE WHEN billing_mode = 'parent' AND parent_id IS NOT NULL THEN parent_id ELSE id END FROM tenants WHERE id = ${tenantId})`;
  return row ? toWallet(row) : null;
}

export type Entry = {
  kind: LedgerKind;
  /** Idempotency key: a Stripe object id, a call id, ... Re-applying the same (kind, ref) is a no-op. */
  ref: string;
  description: string;
  usedBy?: string | null;
};

/**
 * Applies one change to a wallet atomically: locks the workspace row, records the ledger entry,
 * and updates the balance. `delta` is computed from the locked balance, so concurrent calls can't
 * spend the same credits twice. Returns the new balance, or null if this entry was already applied.
 */
export async function applyEntry(walletId: string, entry: Entry, delta: (current: Balances) => Delta): Promise<Balances | null> {
  return sql.begin(async (tx) => {
    const [row] = await tx<{ plan: string; paid: string }[]>`
      SELECT plan_credits_milli AS plan, paid_credits_milli AS paid FROM tenants WHERE id = ${walletId} FOR UPDATE`;
    if (!row) throw new Error(`no workspace ${walletId}`);
    const current = { plan: Number(row.plan), paid: Number(row.paid) };
    const d = delta(current);
    const next = apply(current, d);
    const inserted = await tx`
      INSERT INTO credit_ledger (tenant_id, kind, ref, plan_delta_milli, paid_delta_milli, plan_after_milli, paid_after_milli, used_by, description)
      VALUES (${walletId}, ${entry.kind}, ${entry.ref}, ${d.plan}, ${d.paid}, ${next.plan}, ${next.paid}, ${entry.usedBy ?? null}, ${entry.description})
      ON CONFLICT (tenant_id, kind, ref) DO NOTHING
      RETURNING id`;
    if (inserted.length === 0) return null;
    await tx`UPDATE tenants SET plan_credits_milli = ${next.plan}, paid_credits_milli = ${next.paid} WHERE id = ${walletId}`;
    return next;
  });
}

/** Adds purchased credits (never expire). */
export function addPaidCredits(walletId: string, credits: number, entry: Entry) {
  return applyEntry(walletId, entry, () => ({ plan: 0, paid: toMilli(credits) }));
}

/**
 * Charges a finished call to the wallet that pays for it. Manual-billed workspaces are only
 * recorded in the calls table, as before. Returns the wallet afterwards so the caller can decide
 * whether to top up.
 */
export async function chargeCall(call: { id: string; tenantId: string; seconds: number; agentName: string | null }): Promise<Wallet | null> {
  const wallet = await walletFor(call.tenantId);
  if (!wallet || wallet.mode === "manual") return null;
  const cost = callCostMilli(call.seconds, wallet.creditsPerMinute);
  if (cost === 0) return wallet;
  const minutes = Math.floor(call.seconds / 60);
  const seconds = String(call.seconds % 60).padStart(2, "0");
  const after = await applyEntry(
    wallet.tenantId,
    {
      kind: "call",
      ref: call.id,
      description: `Call ${minutes}:${seconds}${call.agentName ? ` · ${call.agentName}` : ""}`,
      usedBy: call.tenantId === wallet.tenantId ? null : call.tenantId,
    },
    (b) => splitDebit(b, cost),
  );
  return after ? { ...wallet, balances: after } : wallet;
}

/** Charges one chatbot reply. */
export async function chargeChatReply(tenantId: string, ref: string): Promise<Wallet | null> {
  const wallet = await walletFor(tenantId);
  if (!wallet || wallet.mode === "manual") return null;
  const cost = toMilli(catalogFor(wallet.brand).chatReplyCredits);
  if (cost === 0) return wallet;
  const after = await applyEntry(
    wallet.tenantId,
    { kind: "chat", ref, description: "Chatbot reply", usedBy: tenantId === wallet.tenantId ? null : tenantId },
    (b) => splitDebit(b, cost),
  );
  return after ? { ...wallet, balances: after } : wallet;
}

/** True when this workspace may start a call or chat: manual billing, or a positive balance. */
export async function canSpend(tenantId: string): Promise<{ ok: boolean; wallet: Wallet | null }> {
  const wallet = await walletFor(tenantId);
  if (!wallet || wallet.mode === "manual") return { ok: true, wallet };
  return { ok: total(wallet.balances) > 0, wallet };
}

/** New top-level workspaces pay by credits once Stripe is set up; before that, billing stays manual. */
export function defaultBillingMode(): BillingMode {
  const configured = process.env.BILLING_DEFAULT_MODE;
  if (configured === "credits" || configured === "manual") return configured;
  return process.env.STRIPE_SECRET_KEY ? "credits" : "manual";
}

export type LedgerRow = {
  id: string;
  kind: LedgerKind;
  description: string;
  plan_delta_milli: string;
  paid_delta_milli: string;
  plan_after_milli: string;
  paid_after_milli: string;
  used_by_name: string | null;
  created_at: Date;
};

export async function ledger(walletId: string, opts: { limit?: number; usedBy?: string } = {}): Promise<LedgerRow[]> {
  return sql<LedgerRow[]>`
    SELECT l.id, l.kind, l.description, l.plan_delta_milli, l.paid_delta_milli, l.plan_after_milli, l.paid_after_milli,
           u.name AS used_by_name, l.created_at
    FROM credit_ledger l LEFT JOIN tenants u ON u.id = l.used_by
    WHERE l.tenant_id = ${walletId} ${opts.usedBy ? sql`AND l.used_by = ${opts.usedBy}` : sql``}
    ORDER BY l.created_at DESC, l.id DESC LIMIT ${opts.limit ?? 50}`;
}

/** Credits spent this calendar month (UTC), by this workspace only. */
export async function spentThisMonth(walletId: string, usedBy: string | null): Promise<number> {
  const [row] = await sql<{ spent: string }[]>`
    SELECT coalesce(-sum(plan_delta_milli + paid_delta_milli), 0) AS spent FROM credit_ledger
    WHERE tenant_id = ${walletId} AND kind IN ('call', 'chat') AND created_at >= date_trunc('month', now())
      ${usedBy ? sql`AND used_by = ${usedBy}` : sql`AND used_by IS NULL`}`;
  return Number(row?.spent ?? 0);
}

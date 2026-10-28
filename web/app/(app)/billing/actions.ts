"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { catalogFor, findPack, findPlan } from "@/lib/billing/catalog";
import { changePlan, creditPackCheckout, planCheckout, portalUrl, stripeConfigured } from "@/lib/billing/stripe";
import { walletFor, type Wallet } from "@/lib/billing/wallet";
import { sql } from "@/lib/db";

export type BillingState = { error?: string; notice?: string } | undefined;

/** The wallet an owner or admin may pay into: only their own workspace's, never an agency's. */
async function payableWallet(): Promise<{ wallet: Wallet; email: string } | { error: string }> {
  const session = await requireRole("admin");
  if (!stripeConfigured()) return { error: "Online payments aren't set up yet. Contact support." };
  const wallet = await walletFor(session.tenantId);
  if (!wallet || wallet.tenantId !== session.tenantId) return { error: "Credits for this workspace are managed by your agency." };
  const [user] = await sql<{ email: string }[]>`SELECT email FROM users WHERE id = ${session.userId}`;
  return { wallet, email: user.email };
}

export async function buyCredits(_: BillingState, form: FormData): Promise<BillingState> {
  const ctx = await payableWallet();
  if ("error" in ctx) return ctx;
  const pack = findPack(catalogFor(ctx.wallet.brand), form.get("packId")?.toString());
  if (!pack) return { error: "Pick a credit pack." };
  let url: string;
  try {
    url = await creditPackCheckout(ctx.wallet, pack, ctx.email);
  } catch (e) {
    console.error("billing: checkout failed", e);
    return { error: "Couldn't open the payment page. Please try again." };
  }
  redirect(url);
}

export async function choosePlan(_: BillingState, form: FormData): Promise<BillingState> {
  const ctx = await payableWallet();
  if ("error" in ctx) return ctx;
  const plan = findPlan(catalogFor(ctx.wallet.brand), form.get("planId")?.toString());
  if (!plan) return { error: "Pick a plan." };

  const [row] = await sql<{ stripe_subscription_id: string | null; subscription_status: string | null }[]>`
    SELECT stripe_subscription_id, subscription_status FROM tenants WHERE id = ${ctx.wallet.tenantId}`;
  const live = row?.stripe_subscription_id && ["active", "trialing", "past_due"].includes(row.subscription_status ?? "");
  if (!live) {
    let url: string;
    try {
      url = await planCheckout(ctx.wallet, plan, ctx.email);
    } catch (e) {
      console.error("billing: plan checkout failed", e);
      return { error: "Couldn't open the payment page. Please try again." };
    }
    redirect(url);
  }
  if (plan.id === ctx.wallet.planId) return { notice: `You're already on ${plan.name}.` };
  try {
    const when = await changePlan(ctx.wallet, row.stripe_subscription_id!, plan);
    revalidatePath("/billing");
    return {
      notice:
        when === "now"
          ? `Upgraded to ${plan.name}. Your card was charged the difference and your credits were topped up.`
          : `You'll move to ${plan.name} at your next renewal.`,
    };
  } catch (e) {
    console.error("billing: plan change failed", e);
    return { error: "Your card was declined or the change couldn't be made. Update your card under Manage billing and try again." };
  }
}

export async function openBillingPortal(): Promise<void> {
  const ctx = await payableWallet();
  if ("error" in ctx) redirect("/billing");
  const url = await portalUrl(ctx.wallet);
  redirect(url ?? "/billing");
}

const AutoRechargeForm = z.object({
  enabled: z.boolean(),
  thresholdCredits: z.coerce.number().int().min(1, "Enter a balance of at least 1 credit").max(100000),
  packId: z.string(),
});

export async function saveAutoRecharge(_: BillingState, form: FormData): Promise<BillingState> {
  const ctx = await payableWallet();
  if ("error" in ctx) return ctx;
  const parsed = AutoRechargeForm.safeParse({
    enabled: form.get("enabled") === "on",
    thresholdCredits: form.get("thresholdCredits"),
    packId: form.get("packId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!findPack(catalogFor(ctx.wallet.brand), parsed.data.packId)) return { error: "Pick a credit pack." };
  if (parsed.data.enabled && !ctx.wallet.stripeCustomerId) return { error: "Buy credits once first, so there's a saved card to charge." };
  await sql`UPDATE tenants SET auto_recharge = ${sql.json(parsed.data)} WHERE id = ${ctx.wallet.tenantId}`;
  revalidatePath("/billing");
  return { notice: parsed.data.enabled ? "Auto top-up is on." : "Auto top-up is off." };
}

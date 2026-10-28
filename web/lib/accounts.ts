import "server-only";
import type { TransactionSql } from "postgres";
import { catalogFor } from "./billing/catalog";
import { toMilli } from "./billing/credits-math";
import { defaultBillingMode, type BillingMode } from "./billing/wallet";
import { currentBrand } from "./brand";

/** A new person with their own workspace, as its owner. */
export async function createAccount(
  tx: TransactionSql,
  a: {
    email: string;
    name?: string;
    passwordHash: string | null;
    company: string;
    termsAcceptedAt?: Date | null;
    onboarded?: boolean;
    billingMode?: BillingMode;
  },
): Promise<{ userId: string; tenantId: string }> {
  const brand = currentBrand();
  const billingMode = a.billingMode ?? defaultBillingMode();
  const trial = billingMode === "credits" ? toMilli(catalogFor(brand).trialCredits) : 0;
  const [tenant] = await tx<{ id: string }[]>`
    INSERT INTO tenants (name, onboarded_at, brand, billing_mode, paid_credits_milli)
    VALUES (${a.company}, ${a.onboarded ? new Date() : null}, ${brand}, ${billingMode}, ${trial}) RETURNING id`;
  if (trial > 0) {
    await tx`
      INSERT INTO credit_ledger (tenant_id, kind, ref, paid_delta_milli, plan_after_milli, paid_after_milli, description)
      VALUES (${tenant.id}, 'trial', 'signup', ${trial}, 0, ${trial}, 'Free trial credits')`;
  }
  const [user] = await tx<{ id: string }[]>`
    INSERT INTO users (tenant_id, email, name, password_hash, terms_accepted_at, last_login_at)
    VALUES (${tenant.id}, ${a.email}, ${a.name ?? ""}, ${a.passwordHash}, ${a.termsAcceptedAt ?? null}, now()) RETURNING id`;
  await tx`INSERT INTO memberships (tenant_id, user_id, role) VALUES (${tenant.id}, ${user.id}, 'owner')`;
  return { userId: user.id, tenantId: tenant.id };
}

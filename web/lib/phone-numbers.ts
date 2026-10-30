import "server-only";
import { phoneNumberCredits, catalogFor, formatMoney } from "./billing/catalog";
import { splitDebit, toMilli, total } from "./billing/credits-math";
import { applyEntry, walletFor, type Wallet } from "./billing/wallet";
import { sql } from "./db";
import { buyNumber, isCallerIdVerified, releaseNumber, removeCallerId, startCallerIdVerification, TwilioError } from "./twilio";

// Phone numbers get into a workspace two ways, and nothing else adds one:
// - Bought here from the platform's Twilio account, charged monthly in credits.
// - The client's own number, after Twilio phones it and the person who answers enters the code shown
//   in the dashboard. Until then it is 'pending' and calls to it are not answered.

/** How long a verification code is valid; an unfinished claim then stops blocking the number. */
const VERIFY_MINUTES = 15;
/** An unpaid bought number keeps working this long past its paid period, then goes back to Twilio. */
const GRACE_DAYS = 7;

export type NumberPrice = { cents: number; credits: number; label: string };

export function numberPrice(brand: string): NumberPrice {
  const catalog = catalogFor(brand);
  const credits = phoneNumberCredits(catalog);
  return { cents: catalog.phoneNumberCents, credits, label: `${formatMoney(catalog.phoneNumberCents, catalog.currency)}/month` };
}

function chargesCredits(wallet: Wallet | null): wallet is Wallet {
  return wallet !== null && wallet.mode !== "manual";
}

/**
 * Numbers are for paying customers: free trial credits can't buy one, so buying needs a paid plan.
 * Trial and purchased credits share one balance, so the plan is what tells them apart. Manually
 * billed workspaces settle up outside the app and always qualify.
 */
export function canBuyNumbers(wallet: Wallet | null): boolean {
  return !chargesCredits(wallet) || (wallet.planId !== null && wallet.subscriptionStatus === "active");
}

/** Renewal keeps going while Stripe retries a failed plan payment; a cancelled plan stops it. */
function keepsNumbers(wallet: Wallet | null): boolean {
  return canBuyNumbers(wallet) || (wallet?.planId != null && wallet.subscriptionStatus === "past_due");
}

export const NEEDS_PLAN = "Phone numbers come with a paid plan. Start a plan on the Billing page, then buy your number.";

/** Frees the number if another workspace started verifying it and never finished. */
async function clearExpiredClaims(e164: string): Promise<void> {
  await sql`DELETE FROM phone_numbers WHERE e164 = ${e164} AND status = 'pending' AND verify_expires_at < now()`;
}

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function purchaseNumber(tenantId: string, e164: string, agentId: string | null): Promise<Result> {
  await clearExpiredClaims(e164);
  const [taken] = await sql`SELECT 1 FROM phone_numbers WHERE e164 = ${e164}`;
  if (taken) return { ok: false, error: "That number is already in use here. Pick another." };

  const wallet = await walletFor(tenantId);
  if (!canBuyNumbers(wallet)) return { ok: false, error: NEEDS_PLAN };
  const price = numberPrice(wallet?.brand ?? "default");
  const cost = toMilli(price.credits);
  if (chargesCredits(wallet) && total(wallet.balances) < cost) {
    return { ok: false, error: `A number costs ${price.credits} credits a month. Add credits on the Billing page first.` };
  }

  // Charge first, so two quick purchases can't both spend the same credits; refund if Twilio says no.
  const id = crypto.randomUUID();
  const ref = `${id}:1`;
  if (chargesCredits(wallet)) {
    const charged = await applyEntry(
      wallet.tenantId,
      { kind: "phone_number", ref, description: `Phone number ${e164} · first month`, usedBy: tenantId === wallet.tenantId ? null : tenantId },
      (b) => splitDebit(b, cost),
    );
    if (!charged) return { ok: false, error: "That purchase is already being processed." };
  }
  const refund = async () => {
    if (chargesCredits(wallet)) {
      await applyEntry(wallet.tenantId, { kind: "refund", ref, description: `Refund: phone number ${e164} not bought` }, () => ({ plan: 0, paid: cost }));
    }
  };

  let sid: string;
  try {
    sid = await buyNumber(e164, `ws ${tenantId.slice(0, 8)}`);
  } catch (e) {
    await refund();
    if (e instanceof TwilioError && e.status < 500) return { ok: false, error: `That number couldn't be bought: ${e.message}` };
    console.error("twilio: buy failed", e);
    return { ok: false, error: "That number couldn't be bought right now. Try again, or pick another." };
  }
  try {
    await sql`
      INSERT INTO phone_numbers (id, tenant_id, e164, carrier, agent_id, source, status, provider_sid, verified_at, paid_until)
      VALUES (${id}, ${tenantId}, ${e164}, 'twilio',
        (SELECT id FROM agents WHERE id = ${agentId} AND tenant_id = ${tenantId}),
        'platform', 'active', ${sid}, now(), now() + interval '1 month')`;
  } catch (e) {
    await releaseNumber(sid).catch(() => {});
    await refund();
    throw e;
  }
  return { ok: true };
}

/** Starts proving the client owns `e164`: Twilio calls it, and they key in the returned code. */
export async function startVerification(tenantId: string, e164: string, carrier: string, agentId: string | null): Promise<Result<{ id: string; code: string }>> {
  await clearExpiredClaims(e164);
  const [existing] = await sql<{ id: string; tenant_id: string; status: string }[]>`SELECT id, tenant_id, status FROM phone_numbers WHERE e164 = ${e164}`;
  if (existing && !(existing.tenant_id === tenantId && existing.status === "pending")) {
    return { ok: false, error: existing.tenant_id === tenantId ? "This number is already connected." : "This number is already connected to another account." };
  }
  let code: string;
  try {
    code = await startCallerIdVerification(e164, `ws ${tenantId.slice(0, 8)}`);
  } catch (e) {
    if (e instanceof TwilioError && e.status < 500) return { ok: false, error: `We couldn't call that number: ${e.message}` };
    console.error("twilio: verification failed", e);
    return { ok: false, error: "We couldn't start the verification call. Try again in a minute." };
  }
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO phone_numbers (tenant_id, e164, carrier, agent_id, source, status, verify_code, verify_expires_at)
    VALUES (${tenantId}, ${e164}, ${carrier}, (SELECT id FROM agents WHERE id = ${agentId} AND tenant_id = ${tenantId}),
      'byo', 'pending', ${code}, now() + make_interval(mins => ${VERIFY_MINUTES}))
    ON CONFLICT (e164) DO UPDATE SET carrier = EXCLUDED.carrier, agent_id = EXCLUDED.agent_id, verify_code = EXCLUDED.verify_code,
      verify_expires_at = EXCLUDED.verify_expires_at
      WHERE phone_numbers.tenant_id = ${tenantId} AND phone_numbers.status = 'pending'
    RETURNING id`;
  if (!row) return { ok: false, error: "This number is already connected to another account." };
  return { ok: true, id: row.id, code };
}

export type VerificationState = "verified" | "waiting" | "expired" | "gone";

/** Checks with Twilio whether the code was entered, and activates the number if so. */
export async function checkVerification(tenantId: string, id: string): Promise<VerificationState> {
  const [n] = await sql<{ e164: string; status: string; expired: boolean }[]>`
    SELECT e164, status, verify_expires_at < now() AS expired FROM phone_numbers WHERE id = ${id} AND tenant_id = ${tenantId}`;
  if (!n) return "gone";
  if (n.status !== "pending") return "verified";
  if (await isCallerIdVerified(n.e164)) {
    await sql`UPDATE phone_numbers SET status = 'active', verified_at = now(), verify_code = NULL, verify_expires_at = NULL WHERE id = ${id} AND status = 'pending'`;
    return "verified";
  }
  return n.expired ? "expired" : "waiting";
}

/** Removes a number from the workspace; a bought one goes back to Twilio and stops being billed. */
export async function removeNumber(tenantId: string, id: string): Promise<void> {
  const [n] = await sql<{ e164: string; source: string; provider_sid: string | null }[]>`
    SELECT e164, source, provider_sid FROM phone_numbers WHERE id = ${id} AND tenant_id = ${tenantId}`;
  if (!n) return;
  if (n.source === "platform" && n.provider_sid) await releaseNumber(n.provider_sid);
  else await removeCallerId(n.e164).catch(() => {});
  await sql`DELETE FROM phone_numbers WHERE id = ${id} AND tenant_id = ${tenantId}`;
}

/**
 * Monthly billing for bought numbers, run by the maintenance job: renews each number whose paid
 * period ended if the workspace still has its plan and the credits to pay, marks it past due if not,
 * and releases it after the grace period.
 */
export async function renewNumbers(): Promise<{ renewed: number; pastDue: number; released: number }> {
  const result = { renewed: 0, pastDue: 0, released: 0 };
  const due = await sql<{ id: string; tenant_id: string; e164: string; provider_sid: string | null; paid_until: Date; period: string; overdue: boolean }[]>`
    SELECT id, tenant_id, e164, provider_sid, paid_until, paid_until::text AS period, paid_until < now() - make_interval(days => ${GRACE_DAYS}) AS overdue
    FROM phone_numbers WHERE source = 'platform' AND paid_until < now() ORDER BY paid_until LIMIT 500`;
  for (const n of due) {
    try {
      const wallet = await walletFor(n.tenant_id);
      const price = numberPrice(wallet?.brand ?? "default");
      const cost = toMilli(price.credits);
      if (keepsNumbers(wallet) && (!chargesCredits(wallet) || total(wallet.balances) >= cost)) {
        if (chargesCredits(wallet)) {
          // The ref is the period being paid for, so a rerun can't charge the same month twice.
          await applyEntry(
            wallet.tenantId,
            { kind: "phone_number", ref: `${n.id}:${n.paid_until.toISOString().slice(0, 10)}`, description: `Phone number ${n.e164} · monthly`, usedBy: n.tenant_id === wallet.tenantId ? null : n.tenant_id },
            (b) => splitDebit(b, cost),
          );
        }
        // Matching the old paid_until exactly makes this run once per period even if two servers renew at once. Compared as
        // text: the driver turns a timestamptz parameter into a JS Date, which drops Postgres' microseconds.
        await sql`UPDATE phone_numbers SET status = 'active', paid_until = paid_until + interval '1 month' WHERE id = ${n.id} AND paid_until::text = ${n.period}`;
        result.renewed++;
      } else if (n.overdue) {
        if (n.provider_sid) await releaseNumber(n.provider_sid);
        await sql`DELETE FROM phone_numbers WHERE id = ${n.id}`;
        result.released++;
      } else {
        await sql`UPDATE phone_numbers SET status = 'past_due' WHERE id = ${n.id} AND status <> 'past_due'`;
        result.pastDue++;
      }
    } catch (e) {
      console.error(`numbers: renewal of ${n.e164} failed`, e);
    }
  }
  return result;
}

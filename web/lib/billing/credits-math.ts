// Pure credit arithmetic, kept free of database and network code so it can be unit-tested.
//
// Balances are stored in millicredits (1 credit = 1000) as integers, so per-second call billing never
// accumulates floating-point error. A wallet has two buckets: plan credits, which the subscription
// refills (and resets) every billing period, and purchased credits, which never expire. Usage spends
// plan credits first.

export const MILLI = 1000;

export type Balances = { plan: number; paid: number };
export type Delta = { plan: number; paid: number };

export function toMilli(credits: number): number {
  return Math.round(credits * MILLI);
}

export function fromMilli(milli: number): number {
  return milli / MILLI;
}

export function total(b: Balances): number {
  return b.plan + b.paid;
}

/** Millicredits a call of `seconds` costs at `creditsPerMinute`, billed by the second, rounded up. */
export function callCostMilli(seconds: number, creditsPerMinute: number): number {
  if (seconds <= 0 || creditsPerMinute <= 0) return 0;
  return Math.ceil((seconds * creditsPerMinute * MILLI) / 60);
}

/**
 * Takes `amount` from plan credits first, then purchased credits. The call has already happened, so
 * the purchased bucket may go negative; the next top-up pays the overdraft back first.
 */
export function splitDebit(b: Balances, amount: number): Delta {
  if (amount <= 0) return { plan: 0, paid: 0 };
  const fromPlan = Math.min(Math.max(b.plan, 0), amount);
  return { plan: 0 - fromPlan, paid: fromPlan - amount };
}

/** A new billing period: plan credits are set to the plan's allowance and leftovers expire. */
export function planReset(b: Balances, allowance: number): Delta {
  return { plan: allowance - b.plan, paid: 0 };
}

export function apply(b: Balances, d: Delta): Balances {
  return { plan: b.plan + d.plan, paid: b.paid + d.paid };
}

/**
 * How long a call may run on the remaining balance, in seconds, capped by the agent's own limit.
 * Returns 0 when the wallet is empty, which means the call must not be answered.
 */
export function affordableSeconds(b: Balances, creditsPerMinute: number, agentLimitSeconds: number): number {
  const balance = total(b);
  if (balance <= 0) return 0;
  if (creditsPerMinute <= 0) return agentLimitSeconds;
  const seconds = Math.floor((balance * 60) / (creditsPerMinute * MILLI));
  // Never cut a caller off after a few seconds; a short overdraft is better than a rude hang-up.
  return Math.min(agentLimitSeconds, Math.max(seconds, 60));
}

/** True when auto top-up should charge the saved card now. */
export function needsRecharge(b: Balances, thresholdCredits: number): boolean {
  return total(b) < toMilli(thresholdCredits);
}

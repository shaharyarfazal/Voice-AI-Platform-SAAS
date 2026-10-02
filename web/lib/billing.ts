import "server-only";
import { sql } from "./db";
import { callCostSql, getSettings } from "./settings";

export type BillingRow = {
  tenantId: string;
  tenantName: string;
  status: string;
  calls: number;
  minutes: number;
  monthlyFee: number;
  pricePerMinute: number;
  usageCharge: number;
  total: number;
  providerCost: number;
  margin: number;
};

/** "2026-10" → first day of that month; anything else → current month. */
export function parseMonth(value: unknown): string {
  if (typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value;
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Per-client invoice amounts and estimated costs for a calendar month (UTC). Minutes are billed by the second. */
export async function monthlyBilling(month: string) {
  const { rates } = await getSettings();
  const start = `${month}-01T00:00:00Z`;
  const rows = await sql`
    SELECT t.id, t.name, t.status, t.monthly_fee::float AS monthly_fee, t.price_per_minute::float AS price_per_minute,
           count(c.id)::int AS calls, coalesce(sum(c.duration_seconds), 0)::int AS seconds,
           coalesce(sum(${callCostSql(rates)}), 0)::float AS cost
    FROM tenants t
    LEFT JOIN calls c ON c.tenant_id = t.id
      AND c.started_at >= ${start}::timestamptz AND c.started_at < ${start}::timestamptz + interval '1 month'
    GROUP BY t.id ORDER BY t.name`;

  const lines: BillingRow[] = rows.map((r) => {
    const minutes = r.seconds / 60;
    const usageCharge = minutes * r.price_per_minute;
    // Suspended clients still owe usage from before suspension, but no monthly fee.
    const fee = r.status === "active" ? r.monthly_fee : 0;
    const total = fee + usageCharge;
    return {
      tenantId: r.id,
      tenantName: r.name,
      status: r.status,
      calls: r.calls,
      minutes,
      monthlyFee: fee,
      pricePerMinute: r.price_per_minute,
      usageCharge,
      total,
      providerCost: r.cost,
      margin: total - r.cost,
    };
  });
  const revenue = lines.reduce((s, l) => s + l.total, 0);
  const providerCost = lines.reduce((s, l) => s + l.providerCost, 0);
  return {
    lines,
    totals: {
      calls: lines.reduce((s, l) => s + l.calls, 0),
      minutes: lines.reduce((s, l) => s + l.minutes, 0),
      revenue,
      providerCost,
      serverCost: rates.serverMonthly,
      profit: revenue - providerCost - rates.serverMonthly,
    },
  };
}

import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { monthlyBilling, parseMonth } from "@/lib/billing";
import { formatMoney } from "@/lib/format";
import { getSettings, ratesConfigured } from "@/lib/settings";
import { Stat } from "../status";

export default async function BillingPage({ searchParams }: PageProps<"/admin/billing">) {
  await requireAdmin();
  const month = parseMonth((await searchParams).month);
  const [{ lines, totals }, settings] = await Promise.all([monthlyBilling(month), getSettings()]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Billing</h1>
          <p className="mt-1 text-sm text-muted">
            What each client owes for the month, and what their calls cost you. Set prices per client on the Clients page.
          </p>
        </div>
        <form className="flex items-end gap-2">
          <div>
            <label className="label" htmlFor="month">Month</label>
            <input className="input" type="month" id="month" name="month" defaultValue={month} />
          </div>
          <button className="btn-secondary">Show</button>
          <a className="btn" href={`/api/admin/billing?month=${month}`}>Download CSV</a>
        </form>
      </div>

      {!ratesConfigured(settings.rates) && (
        <p className="rounded-md border border-border p-3 text-sm text-muted">
          Costs show $0 until you enter your provider rates in <Link className="underline" href="/admin/settings">Settings</Link>.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Revenue" value={formatMoney(totals.revenue)} sub={`${Math.round(totals.minutes).toLocaleString()} min · ${totals.calls} calls`} />
        <Stat label="AI and phone costs" value={formatMoney(totals.providerCost)} sub="estimated from usage" />
        <Stat label="Server cost" value={formatMoney(totals.serverCost)} />
        <Stat label="Profit" value={<span className={totals.profit < 0 ? "text-critical" : ""}>{formatMoney(totals.profit)}</span>} />
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th className="pl-4">Client</th><th>Calls</th><th>Minutes</th><th>Monthly fee</th><th>Per minute</th>
              <th>Usage</th><th>Total due</th><th>Est. cost</th><th>Margin</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.tenantId}>
                <td className="pl-4">
                  <Link className="underline" href={`/admin/tenants/${l.tenantId}`}>{l.tenantName}</Link>
                  {l.status !== "active" && <span className="ml-1 text-xs text-muted">(suspended)</span>}
                </td>
                <td className="tabular-nums">{l.calls}</td>
                <td className="tabular-nums">{l.minutes.toFixed(1)}</td>
                <td className="tabular-nums">{formatMoney(l.monthlyFee)}</td>
                <td className="tabular-nums">{formatMoney(l.pricePerMinute)}</td>
                <td className="tabular-nums">{formatMoney(l.usageCharge)}</td>
                <td className="tabular-nums font-medium">{formatMoney(l.total)}</td>
                <td className="tabular-nums">{formatMoney(l.providerCost)}</td>
                <td className={`tabular-nums ${l.margin < 0 ? "text-critical" : ""}`}>{formatMoney(l.margin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        Costs are estimates from each call&apos;s recorded usage and your rates in Settings; check them against your provider invoices.
        Taking payments (Stripe) isn&apos;t built yet: use the CSV to invoice clients.
      </p>
    </div>
  );
}

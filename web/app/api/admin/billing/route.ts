import { getAdminSession } from "@/lib/auth";
import { monthlyBilling, parseMonth } from "@/lib/billing";

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** CSV of one month's billing, for invoicing or accounting. */
export async function GET(request: Request) {
  if (!(await getAdminSession())) return new Response("Not found", { status: 404 });
  const month = parseMonth(new URL(request.url).searchParams.get("month"));
  const { lines } = await monthlyBilling(month);
  const header = ["Client", "Status", "Calls", "Minutes", "Monthly fee", "Price per minute", "Usage charge", "Total due", "Est. provider cost", "Margin"];
  const body = lines.map((l) =>
    [l.tenantName, l.status, l.calls, l.minutes.toFixed(2), l.monthlyFee.toFixed(2), l.pricePerMinute.toFixed(4),
     l.usageCharge.toFixed(2), l.total.toFixed(2), l.providerCost.toFixed(2), l.margin.toFixed(2)].map(csvCell).join(","),
  );
  return new Response([header.join(","), ...body].join("\n") + "\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="billing-${month}.csv"`,
    },
  });
}

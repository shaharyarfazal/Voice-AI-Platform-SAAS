"use client";

import { useActionState } from "react";
import { buyCredits, choosePlan, saveAutoRecharge, type BillingState } from "./actions";

function Message({ state }: { state: BillingState }) {
  if (state?.error) return <p role="alert" className="text-sm text-critical">▲ <span className="text-foreground">{state.error}</span></p>;
  if (state?.notice) return <p role="status" className="text-sm text-good">✓ <span className="text-foreground">{state.notice}</span></p>;
  return null;
}

/** One credit pack: the button opens Stripe Checkout. */
export function BuyPackButton({ packId, label, price, disabled }: { packId: string; label: string; price: string; disabled?: boolean }) {
  const [state, action, pending] = useActionState(buyCredits, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="packId" value={packId} />
      <button
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-border px-4 py-3 text-left transition hover:border-accent hover:bg-accent/5 disabled:opacity-50"
        disabled={disabled || pending}
      >
        <span>
          <span className="block font-medium">{label}</span>
          <span className="text-sm text-muted">{pending ? "Opening secure checkout…" : "One-time · never expires"}</span>
        </span>
        <span className="text-lg font-semibold tabular-nums">{price}</span>
      </button>
      <Message state={state} />
    </form>
  );
}

export function ChoosePlanButton({ planId, label, primary, disabled }: { planId: string; label: string; primary?: boolean; disabled?: boolean }) {
  const [state, action, pending] = useActionState(choosePlan, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="planId" value={planId} />
      <button className={`${primary ? "btn" : "btn-secondary"} w-full`} disabled={disabled || pending}>
        {pending ? "One moment…" : label}
      </button>
      <Message state={state} />
    </form>
  );
}

export function AutoRechargeForm({
  enabled,
  thresholdCredits,
  packId,
  packs,
  lastError,
  canEnable,
}: {
  enabled: boolean;
  thresholdCredits: number;
  packId: string;
  packs: { id: string; label: string }[];
  lastError?: string;
  canEnable: boolean;
}) {
  const [state, action, pending] = useActionState(saveAutoRecharge, undefined);
  return (
    <form action={action} className="space-y-4">
      <label className="toggle-row">
        <input type="checkbox" name="enabled" defaultChecked={enabled} className="mt-1 h-4 w-4 accent-[var(--accent)]" />
        <span>
          <span className="block text-sm font-medium">Top up automatically</span>
          <span className="block text-sm text-muted">
            Your saved card is charged when credits run low, so your agents never stop answering.
            {!canEnable && " Buy a credit pack once to save a card."}
          </span>
        </span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="thresholdCredits">When the balance drops below</label>
          <div className="relative">
            <input className="input pr-16" id="thresholdCredits" name="thresholdCredits" type="number" min={1} defaultValue={thresholdCredits} required />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">credits</span>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="packId">Buy</label>
          <select className="input" id="packId" name="packId" defaultValue={packId}>
            {packs.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
      </div>
      {lastError && <p className="text-sm text-critical">▲ <span className="text-foreground">Last top-up failed: {lastError}</span></p>}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
        <Message state={state} />
      </div>
    </form>
  );
}

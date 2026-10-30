"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { buy, searchAvailable, startVerify, verificationState } from "./actions";

type Agent = { id: string; name: string };

function AgentSelect({ agents, id }: { agents: Agent[]; id: string }) {
  return (
    <select className="input" id={id} name="agentId" defaultValue={agents[0]?.id ?? ""}>
      <option value="">Nobody yet</option>
      {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  );
}

export function BuyNumber({ agents, price, countries, subscribed }: { agents: Agent[]; price: { label: string; credits: number }; countries: readonly { code: string; label: string }[]; subscribed: boolean }) {
  const [search, searchAction, searching] = useActionState(searchAvailable, undefined);
  const [bought, buyAction, buying] = useActionState(buy, undefined);
  if (!subscribed) {
    return (
      <div className="card space-y-3">
        <div className="font-medium">Get a new number</div>
        <p className="text-sm text-muted">
          Numbers come with a paid plan ({price.label} each, taken from your credits). Free trial credits can&apos;t be used for a number.
          You can still connect a number you already have below.
        </p>
        <Link className="btn inline-flex" href="/billing#plans">Start a plan</Link>
      </div>
    );
  }
  return (
    <div className="card space-y-4">
      <div>
        <div className="font-medium">Get a new number</div>
        <p className="mt-1 text-sm text-muted">
          Ready to take calls straight away, no carrier setup. {price.label} ({price.credits} credits), taken from your credits each month. Remove it any time.
        </p>
      </div>
      <form action={searchAction} className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <div>
          <label className="label" htmlFor="buy-country">Country</label>
          <select className="input" id="buy-country" name="country" defaultValue="US">
            {countries.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="buy-area">Area code (optional)</label>
          <input className="input" id="buy-area" name="areaCode" inputMode="numeric" maxLength={3} placeholder="415" />
        </div>
        <div>
          <label className="label" htmlFor="buy-contains">Contains (optional)</label>
          <input className="input" id="buy-contains" name="contains" inputMode="numeric" maxLength={7} placeholder="2020" />
        </div>
        <button className="btn-secondary" disabled={searching}>{searching ? "Searching…" : "Search"}</button>
      </form>
      {search?.error && <p className="text-sm text-critical">{search.error}</p>}
      {search?.results && (
        <form action={buyAction} className="space-y-3">
          <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
            {search.results.map((n, i) => (
              <label key={n.e164} className="toggle-row">
                <input type="radio" name="e164" value={n.e164} defaultChecked={i === 0} className="mt-1 accent-[var(--accent)]" />
                <span>
                  <span className="block font-mono text-sm">{n.e164}</span>
                  <span className="block text-xs text-muted">{[n.locality, n.region].filter(Boolean).join(", ") || " "}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-56">
              <label className="label" htmlFor="buy-agent">Answered by</label>
              <AgentSelect agents={agents} id="buy-agent" />
            </div>
            <button className="btn" disabled={buying}>{buying ? "Buying…" : `Buy for ${price.label}`}</button>
          </div>
        </form>
      )}
      {bought?.error && <p className="text-sm text-critical">{bought.error}</p>}
      {bought?.bought && <p className="text-sm text-good">✓ {bought.bought} is yours and ready for calls.</p>}
    </div>
  );
}

export function ConnectOwnNumber({ agents, sipHost }: { agents: Agent[]; sipHost: string | null }) {
  const [state, action, pending] = useActionState(startVerify, undefined);
  const [checked, setChecked] = useState<{ id: string; state: "waiting" | "verified" | "expired" | "gone" } | null>(null);
  // A new verification starts out waiting until the first check answers.
  const result = state?.id ? (checked?.id === state.id ? checked.state : "waiting") : null;

  useEffect(() => {
    const id = state?.id;
    if (!id) return;
    let stop = false;
    const tick = async () => {
      const s = await verificationState(id).catch(() => "waiting" as const);
      if (stop) return;
      setChecked({ id, state: s });
      if (s === "waiting") setTimeout(tick, 4000);
    };
    const t = setTimeout(tick, 6000);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [state?.id]);

  return (
    <div className="card space-y-4">
      <div>
        <div className="font-medium">Connect your own number</div>
        <p className="mt-1 text-sm text-muted">
          Keep the number your customers already know. To prove it&apos;s yours, we call it and you type a code on the phone&apos;s keypad. Only verified numbers can be added.
        </p>
      </div>
      <form action={action} className="grid gap-4 md:grid-cols-3">
        <div>
          <label className="label" htmlFor="own-e164">Your number</label>
          <input className="input" id="own-e164" name="e164" placeholder="+14155550100" inputMode="tel" required />
        </div>
        <div>
          <label className="label" htmlFor="own-carrier">Phone provider</label>
          <select className="input" id="own-carrier" name="carrier" defaultValue="twilio">
            <option value="twilio">Twilio</option>
            <option value="telnyx">Telnyx</option>
            <option value="other">Other SIP provider</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="own-agent">Answered by</label>
          <AgentSelect agents={agents} id="own-agent" />
        </div>
        <div className="md:col-span-3">
          <button className="btn" disabled={pending || result === "waiting"}>{pending ? "Calling…" : "Call me to verify"}</button>
        </div>
      </form>
      {state?.error && <p className="text-sm text-critical">{state.error}</p>}
      {state?.code && result === "waiting" && (
        <div className="rounded-lg border border-accent bg-accent/5 p-4 text-sm" aria-live="polite">
          <p>We&apos;re calling <span className="font-mono">{state.e164}</span> now. Answer it and enter this code when asked:</p>
          <p className="my-2 font-mono text-3xl tracking-widest">{state.code}</p>
          <p className="text-muted">Waiting for the code… This page updates by itself. Answer before you point the number at us below, or the call can&apos;t reach you.</p>
        </div>
      )}
      {result === "verified" && <p className="text-sm text-good">✓ {state?.e164} is verified and connected.</p>}
      {result === "expired" && <p className="text-sm text-critical">The code expired before it was entered. Start again.</p>}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">How to send calls from your provider to us</summary>
        <div className="mt-2 space-y-2 text-muted">
          <p>Verify the number first. Then, in your provider&apos;s portal, route the number&apos;s incoming calls to:</p>
          <p className="font-mono text-foreground">{sipHost ? `sip:<your number>@${sipHost}` : "our SIP address (ask support)"}</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><b>Twilio:</b> add that address as the Origination URI of an Elastic SIP Trunk and put the number on the trunk.</li>
            <li><b>Telnyx:</b> on a SIP Connection, set the inbound destination to that address and the number format to +E.164.</li>
            <li><b>Other providers:</b> contact support first. We accept calls only from carrier IP addresses we&apos;ve approved.</li>
          </ul>
        </div>
      </details>
    </div>
  );
}

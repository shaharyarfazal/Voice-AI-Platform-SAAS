"use client";

import Link from "next/link";
import { useActionState } from "react";
import { dial } from "./outbound-actions";

/** Places a real phone call from this agent. */
export function OutboundCall({ agentId, numbers }: { agentId: string; numbers: string[] }) {
  const [state, action, pending] = useActionState(dial.bind(null, agentId), undefined);
  return (
    <form action={action} className="card space-y-4">
      <div>
        <div className="font-medium">Call a number</div>
        <div className="text-sm text-muted">The agent calls this person now and starts talking when they answer. Only call people who agreed to hear from you.</div>
      </div>
      {numbers.length === 0 ? (
        <p className="text-sm text-muted">Add a phone number first: it&apos;s shown as the caller ID. <Link className="text-accent underline" href="/numbers">Phone numbers</Link></p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <label className="label" htmlFor="dial-to">Number to call</label>
              <input className="input" id="dial-to" name="to" placeholder="+14155550100" required inputMode="tel" />
            </div>
            <div className="min-w-0">
              <label className="label" htmlFor="dial-from">Caller ID</label>
              <select className="input" id="dial-from" name="from">
                {numbers.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="dial-vars">Details for the agent (optional)</label>
            <textarea className="input min-h-20 font-mono text-[13px]" id="dial-vars" name="variables" placeholder={"name: Sara Khan\nappointment: Friday 10am"} />
            <p className="hint">One per line, as <code>key: value</code>. The agent uses them in the conversation.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn" disabled={pending}>{pending ? "Dialling…" : "Call now"}</button>
            {state?.error && <p className="text-sm text-critical">▲ <span className="text-foreground">{state.error}</span></p>}
            {state?.callId && <p className="text-sm text-good">✓ <span className="text-foreground">Calling {state.to}. It appears under <Link href="/calls" className="underline">Calls</Link> when it ends.</span></p>}
          </div>
        </>
      )}
    </form>
  );
}

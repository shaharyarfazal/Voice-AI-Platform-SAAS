"use client";

import { useActionState } from "react";
import { addNumber } from "./actions";

export function AddNumberForm({ agents }: { agents: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(addNumber, undefined);
  return (
    <form action={action} className="card space-y-4">
      <div className="font-medium">Add a phone number</div>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className="label" htmlFor="e164">Number</label>
          <input className="input" id="e164" name="e164" placeholder="+14155550100" required />
        </div>
        <div>
          <label className="label" htmlFor="carrier">Carrier</label>
          <select className="input" id="carrier" name="carrier" defaultValue="telnyx">
            <option value="telnyx">Telnyx</option>
            <option value="twilio">Twilio</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="agentId">Answered by</label>
          <select className="input" id="agentId" name="agentId" defaultValue={agents[0]?.id ?? ""}>
            <option value="">Nobody (calls are rejected)</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button className="btn" disabled={pending}>Add number</button>
    </form>
  );
}

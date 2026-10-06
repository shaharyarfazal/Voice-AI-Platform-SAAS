"use client";

import { useActionState } from "react";
import { createClient, updateClient } from "./actions";

export function NewClientForm() {
  const [state, action, pending] = useActionState(createClient, undefined);
  return (
    <form action={action} className="card space-y-4">
      <div className="font-medium">Add a client</div>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className="label" htmlFor="company">Company</label>
          <input className="input" id="company" name="company" required />
        </div>
        <div>
          <label className="label" htmlFor="email">Login email</label>
          <input className="input" id="email" name="email" type="email" required />
        </div>
        <div>
          <label className="label" htmlFor="password">Temporary password</label>
          <input className="input" id="password" name="password" type="text" minLength={8} required autoComplete="off" />
        </div>
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button className="btn" disabled={pending}>Create client</button>
    </form>
  );
}

export type ClientFormValues = {
  id: string;
  name: string;
  status: string;
  price_per_minute: string;
  monthly_fee: string;
  monthly_minute_limit: number | null;
  transcript_retention_days: number;
  notes: string;
};

export function ClientSettingsForm({ client }: { client: ClientFormValues }) {
  const [state, action, pending] = useActionState(updateClient, undefined);
  return (
    <form action={action} className="card space-y-4">
      <input type="hidden" name="id" value={client.id} />
      <div className="font-medium">Account and pricing</div>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className="label" htmlFor="name">Company name</label>
          <input className="input" id="name" name="name" defaultValue={client.name} required />
        </div>
        <div>
          <label className="label" htmlFor="status">Status</label>
          <select className="input" id="status" name="status" defaultValue={client.status}>
            <option value="active">Active</option>
            <option value="suspended">Suspended (calls are rejected)</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="monthlyMinuteLimit">Monthly minute limit</label>
          <input
            className="input"
            id="monthlyMinuteLimit"
            name="monthlyMinuteLimit"
            inputMode="numeric"
            placeholder="No limit"
            defaultValue={client.monthly_minute_limit ?? ""}
          />
        </div>
        <div>
          <label className="label" htmlFor="monthlyFee">Monthly fee (USD)</label>
          <input className="input" id="monthlyFee" name="monthlyFee" inputMode="decimal" defaultValue={client.monthly_fee} />
        </div>
        <div>
          <label className="label" htmlFor="pricePerMinute">Price per minute (USD)</label>
          <input className="input" id="pricePerMinute" name="pricePerMinute" inputMode="decimal" defaultValue={client.price_per_minute} />
        </div>
        <div>
          <label className="label" htmlFor="transcriptRetentionDays">Delete transcripts and recordings after (days)</label>
          <input
            className="input"
            id="transcriptRetentionDays"
            name="transcriptRetentionDays"
            inputMode="numeric"
            defaultValue={client.transcript_retention_days}
          />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="notes">Internal notes</label>
        <textarea className="input min-h-20" id="notes" name="notes" defaultValue={client.notes} />
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.saved && <p className="text-sm text-green-600">Saved.</p>}
      <button className="btn" disabled={pending}>Save</button>
    </form>
  );
}

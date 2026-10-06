"use client";

import { useActionState } from "react";
import { CopyButton } from "@/components/copy-button";
import { createSubAccount } from "../actions";

export function SubAccountForm() {
  const [state, action, pending] = useActionState(createSubAccount, undefined);
  return (
    <form action={action} className="card space-y-4">
      <h2 className="text-lg font-semibold">New client workspace</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <label className="label" htmlFor="sub-name">Client name</label>
          <input className="input" id="sub-name" name="name" required maxLength={200} placeholder="Smile Dental" />
        </div>
        <div className="min-w-0">
          <label className="label" htmlFor="sub-email">Invite the client (optional)</label>
          <input className="input" id="sub-email" name="email" type="email" placeholder="owner@smiledental.com" />
          <p className="hint">They join as an admin of their own workspace only.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" disabled={pending}>{pending ? "Creating…" : "Create workspace"}</button>
        {state?.error && <p className="text-sm text-critical">▲ <span className="text-foreground">{state.error}</span></p>}
        {state?.links && state.links.length === 0 && <p className="text-sm text-good">✓ <span className="text-foreground">Created</span></p>}
      </div>
      {state?.links?.map((l) => (
        <div key={l.email} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface p-3 text-sm">
          <span>Created. Invite link for {l.email}:</span>
          <CopyButton value={l.url} label="Copy invite link" />
        </div>
      ))}
    </form>
  );
}

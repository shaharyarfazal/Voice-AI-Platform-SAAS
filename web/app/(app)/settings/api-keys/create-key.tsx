"use client";

import { useActionState, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { createApiKey } from "../actions";

export function CreateKeyForm() {
  const [state, action, pending] = useActionState(createApiKey, undefined);
  const [shown, setShown] = useState(false);
  return (
    <form action={action} className="card space-y-4">
      <h2 className="text-lg font-semibold">Create a key</h2>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <label className="label" htmlFor="key-name">Name</label>
          <input className="input" id="key-name" name="name" placeholder="Production server" required maxLength={100} />
        </div>
        <div>
          <label className="label" htmlFor="expiry">Expires</label>
          <select className="input" id="expiry" name="expiry" defaultValue="90">
            <option value="30">In 30 days</option>
            <option value="90">In 90 days</option>
            <option value="365">In 1 year</option>
            <option value="never">Never</option>
          </select>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" disabled={pending} onClick={() => setShown(false)}>{pending ? "Creating…" : "Create key"}</button>
        {state?.error && <p className="text-sm text-critical">▲ <span className="text-foreground">{state.error}</span></p>}
      </div>
      {state?.key && (
        <div className="space-y-2 rounded-lg border border-accent/40 bg-accent/5 p-4">
          <p className="text-sm font-medium">Key &ldquo;{state.name}&rdquo; created. Copy it now: it won&apos;t be shown again.</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-3 py-2 font-mono text-xs" aria-label="API key">
              {shown ? state.key : `${state.key.slice(0, 12)}${"•".repeat(28)}`}
            </code>
            <CopyButton value={state.key} label="Copy key" className="btn" />
            <button type="button" className="btn-secondary" onClick={() => setShown((v) => !v)}>{shown ? "Hide" : "Show"}</button>
          </div>
        </div>
      )}
    </form>
  );
}

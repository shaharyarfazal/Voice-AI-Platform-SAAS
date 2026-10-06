"use client";

import { useActionState } from "react";
import { CopyButton } from "@/components/copy-button";
import { inviteMembers } from "../actions";

export function InviteForm() {
  const [state, action, pending] = useActionState(inviteMembers, undefined);
  return (
    <form action={action} className="card space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Invite people</h2>
        <p className="text-sm text-muted">Each person gets a personal link, valid for 7 days. Send it however you like (email, WhatsApp, Slack).</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <label className="label" htmlFor="emails">Email addresses</label>
          <textarea className="input min-h-20" id="emails" name="emails" placeholder={"sara@example.com, ali@example.com"} required />
          <p className="hint">Separate several with commas or new lines.</p>
        </div>
        <div>
          <label className="label" htmlFor="role">Role</label>
          <select className="input" id="role" name="role" defaultValue="member">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" disabled={pending}>{pending ? "Creating links…" : "Create invite links"}</button>
        {state?.error && <p className="text-sm text-critical">▲ <span className="text-foreground">{state.error}</span></p>}
      </div>
      {state?.links && state.links.length > 0 && (
        <ul className="space-y-2 rounded-lg bg-surface p-3">
          {state.links.map((l) => (
            <li key={l.email} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">{l.email}</span>
              <CopyButton value={l.url} label="Copy invite link" />
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

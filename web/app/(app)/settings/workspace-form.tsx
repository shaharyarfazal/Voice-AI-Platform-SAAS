"use client";

import { useActionState } from "react";
import { updateWorkspace } from "./actions";

export function WorkspaceForm({ name, website, canEdit }: { name: string; website: string; canEdit: boolean }) {
  const [state, action, pending] = useActionState(updateWorkspace, undefined);
  return (
    <form action={action} className="card space-y-4">
      <div>
        <label className="label" htmlFor="name">Workspace name</label>
        <input className="input" id="name" name="name" defaultValue={name} disabled={!canEdit} required />
      </div>
      <div>
        <label className="label" htmlFor="website">Website</label>
        <input className="input" id="website" name="website" type="url" defaultValue={website} disabled={!canEdit} placeholder="https://example.com" />
      </div>
      {canEdit && (
        <div className="flex items-center gap-3">
          <button className="btn" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
          {state?.error && <p className="text-sm text-critical">▲ <span className="text-foreground">{state.error}</span></p>}
          {state?.saved && <p className="text-sm text-good">✓ <span className="text-foreground">Saved</span></p>}
        </div>
      )}
    </form>
  );
}

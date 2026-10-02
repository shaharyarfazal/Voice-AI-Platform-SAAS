"use client";

import { useActionState } from "react";
import { resetPassword } from "./actions";

export function ResetPassword({ id }: { id: string }) {
  const [state, action, pending] = useActionState(resetPassword, undefined);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input className="input w-36 py-1" name="password" placeholder="New password" minLength={8} required autoComplete="off" />
      <button className="btn-secondary py-1" disabled={pending}>Set</button>
      {state?.error && <span className="text-xs text-critical">{state.error}</span>}
      {state?.message && <span className="text-xs text-good">✓ <span className="text-foreground">{state.message}</span></span>}
    </form>
  );
}

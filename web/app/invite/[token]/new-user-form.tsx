"use client";

import { useActionState } from "react";
import { acceptAsNewUser } from "./actions";

export function NewUserForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState(acceptAsNewUser.bind(null, token), undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input className="input" id="email" value={email} disabled />
      </div>
      <div>
        <label className="label" htmlFor="name">Your name</label>
        <input className="input" id="name" name="name" autoComplete="name" required />
      </div>
      <div>
        <label className="label" htmlFor="password">Choose a password</label>
        <input className="input" id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
      </div>
      {state?.error && <p className="text-sm text-critical">▲ <span className="text-foreground">{state.error}</span></p>}
      <button className="btn w-full" disabled={pending}>{pending ? "Joining…" : "Create login and join"}</button>
    </form>
  );
}

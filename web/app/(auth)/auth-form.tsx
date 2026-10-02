"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, signup } from "./actions";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [state, action, pending] = useActionState(mode === "login" ? login : signup, undefined);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-12">
      <h1 className="mb-6 text-2xl font-semibold">{mode === "login" ? "Sign in" : "Create your account"}</h1>
      <form action={action} className="space-y-4">
        {mode === "signup" && (
          <div>
            <label className="label" htmlFor="company">Company name</label>
            <input className="input" id="company" name="company" required />
          </div>
        )}
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input
            className="input"
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={8}
            required
          />
        </div>
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button className="btn w-full" disabled={pending}>
          {mode === "login" ? "Sign in" : "Create account"}
        </button>
      </form>
      <p className="mt-4 text-sm text-muted">
        {mode === "login" ? (
          <>No account? <Link className="underline" href="/signup">Sign up</Link></>
        ) : (
          <>Already have an account? <Link className="underline" href="/login">Sign in</Link></>
        )}
      </p>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, signup } from "./actions";

type Props = {
  mode: "login" | "signup";
  termsUrl?: string;
  privacyUrl?: string;
  ssoProviders?: ("google" | "microsoft")[];
  notice?: string;
};

const SSO_LABEL = { google: "Continue with Google", microsoft: "Continue with Microsoft" };

export function AuthForm({ mode, termsUrl, privacyUrl, ssoProviders = [], notice }: Props) {
  const [state, action, pending] = useActionState(mode === "login" ? login : signup, undefined);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-12">
      <h1 className="mb-6 text-2xl font-semibold">{mode === "login" ? "Sign in" : "Create your account"}</h1>
      {notice && <p className="mb-4 rounded-lg border border-critical/40 bg-critical/5 p-3 text-sm">{notice}</p>}
      {ssoProviders.length > 0 && (
        <div className="mb-6 space-y-2">
          {ssoProviders.map((p) => (
            <a key={p} href={`/api/oauth/${p}/start?purpose=login`} className="btn-secondary w-full gap-2">
              <span aria-hidden className="font-semibold">{p === "google" ? "G" : "M"}</span>
              {SSO_LABEL[p]}
            </a>
          ))}
          <div className="flex items-center gap-3 pt-2 text-xs text-muted">
            <span className="h-px flex-1 bg-border" />or with email<span className="h-px flex-1 bg-border" />
          </div>
        </div>
      )}
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
        {mode === "signup" && (termsUrl || privacyUrl) && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="terms" required className="mt-1" />
            <span>
              I agree to the{" "}
              {termsUrl && <a className="underline" href={termsUrl} target="_blank" rel="noreferrer">Terms of Service</a>}
              {termsUrl && privacyUrl && " and "}
              {privacyUrl && <a className="underline" href={privacyUrl} target="_blank" rel="noreferrer">Privacy Policy</a>}
            </span>
          </label>
        )}
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

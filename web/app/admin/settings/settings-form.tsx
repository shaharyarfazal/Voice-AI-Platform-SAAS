"use client";

import { useActionState } from "react";
import type { PlatformSettings } from "@/lib/settings";
import { updateSettings } from "./actions";

const RATE_FIELDS: { name: keyof PlatformSettings["rates"]; label: string; hint: string }[] = [
  { name: "sttPerMinute", label: "Speech-to-text, per minute", hint: "Deepgram streaming price for your model" },
  { name: "llmInputPerMillion", label: "LLM input, per 1M tokens", hint: "OpenAI price for your model" },
  { name: "llmOutputPerMillion", label: "LLM output, per 1M tokens", hint: "OpenAI price for your model" },
  { name: "ttsPerThousandChars", label: "Text-to-speech, per 1,000 characters", hint: "Cartesia price for your plan" },
  { name: "telephonyPerMinute", label: "Phone calls, per minute", hint: "Telnyx/Twilio inbound SIP rate (phone calls only)" },
  { name: "serverMonthly", label: "Servers, per month", hint: "Contabo and anything else fixed" },
];

export function SettingsForm({ settings }: { settings: PlatformSettings }) {
  const [state, action, pending] = useActionState(updateSettings, undefined);
  return (
    <form action={action} className="space-y-8">
      <section className="card space-y-4">
        <h2 className="font-medium">Sign-up</h2>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="allowSignup" defaultChecked={settings.allowSignup} className="mt-1" />
          <span>
            Anyone can create a client account at /signup
            <span className="block text-muted">Leave off while you onboard clients yourself from the Clients page.</span>
          </span>
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="termsUrl">Terms of Service link</label>
            <input className="input" id="termsUrl" name="termsUrl" defaultValue={settings.termsUrl} placeholder="https://" />
          </div>
          <div>
            <label className="label" htmlFor="privacyUrl">Privacy Policy link</label>
            <input className="input" id="privacyUrl" name="privacyUrl" defaultValue={settings.privacyUrl} placeholder="https://" />
          </div>
        </div>
        <p className="text-xs text-muted">With either link set, sign-up requires ticking an &quot;I agree&quot; box, and the date is recorded.</p>
      </section>

      <section className="card space-y-4">
        <h2 className="font-medium">What every agent says and follows</h2>
        <div>
          <label className="label" htmlFor="disclosure">AI disclosure, spoken before the greeting</label>
          <input className="input" id="disclosure" name="disclosure" defaultValue={settings.disclosure} />
          <p className="mt-1 text-xs text-muted">Clients can turn this off per agent if their own greeting already discloses it.</p>
        </div>
        <div>
          <label className="label" htmlFor="safetyInstructions">Safety rules, added to every agent&apos;s instructions</label>
          <textarea className="input min-h-28" id="safetyInstructions" name="safetyInstructions" defaultValue={settings.safetyInstructions} />
        </div>
        <div>
          <label className="label" htmlFor="apologyMessage">Spoken if an AI provider fails mid-call, before hanging up</label>
          <input className="input" id="apologyMessage" name="apologyMessage" defaultValue={settings.apologyMessage} required />
        </div>
      </section>

      <section className="card space-y-4">
        <div>
          <h2 className="font-medium">Your costs (USD)</h2>
          <p className="mt-1 text-sm text-muted">
            Enter your providers&apos; current prices from their pricing pages. They&apos;re used to estimate each call&apos;s cost and your margins.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {RATE_FIELDS.map((f) => (
            <div key={f.name}>
              <label className="label" htmlFor={f.name}>{f.label}</label>
              <input className="input" id={f.name} name={f.name} inputMode="decimal" defaultValue={settings.rates[f.name]} />
              <p className="mt-1 text-xs text-muted">{f.hint}</p>
            </div>
          ))}
        </div>
      </section>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.saved && <p className="text-sm text-green-600">Saved. Agents use the new wording from their next call.</p>}
      <button className="btn" disabled={pending}>Save settings</button>
    </form>
  );
}

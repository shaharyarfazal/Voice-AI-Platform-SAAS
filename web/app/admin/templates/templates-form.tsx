"use client";

import { useActionState, useState } from "react";
import type { Templates } from "@/lib/templates";
import { updateTemplates } from "./actions";

const LABELS = { inbound: "Inbound receptionist", outbound: "Outbound caller", chat: "Website chatbot" } as const;
const PLACEHOLDERS = ["business_name", "industry", "website", "phone", "business_profile"];

export function TemplatesForm({ templates }: { templates: Templates }) {
  const [state, action, pending] = useActionState(updateTemplates, undefined);
  const [tab, setTab] = useState<keyof Templates>("inbound");
  return (
    <form action={action} className="space-y-4">
      <div className="flex gap-2" role="tablist">
        {(Object.keys(LABELS) as (keyof Templates)[]).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-full border px-3 py-1.5 text-sm ${tab === k ? "border-accent bg-accent/10 font-medium" : "border-border text-muted"}`}>
            {LABELS[k]}
          </button>
        ))}
      </div>
      {(Object.keys(LABELS) as (keyof Templates)[]).map((k) => (
        <section key={k} hidden={tab !== k} className="card space-y-4">
          <div>
            <label className="label" htmlFor={`${k}-name`}>Agent name</label>
            <input className="input" id={`${k}-name`} name={`${k}.name`} defaultValue={templates[k].name} maxLength={100} />
          </div>
          <div>
            <label className="label" htmlFor={`${k}-greeting`}>{k === "chat" ? "First message" : "Greeting"}</label>
            <input className="input" id={`${k}-greeting`} name={`${k}.greeting`} defaultValue={templates[k].greeting} maxLength={500} />
          </div>
          <div>
            <label className="label" htmlFor={`${k}-prompt`}>Instructions</label>
            <textarea className="input min-h-96 font-mono text-[13px]" id={`${k}-prompt`} name={`${k}.prompt`} defaultValue={templates[k].prompt} maxLength={20000} />
          </div>
        </section>
      ))}
      <p className="text-sm text-muted">
        Placeholders: {PLACEHOLDERS.map((p, i) => <span key={p}>{i > 0 && ", "}<code>{`{{${p}}}`}</code></span>)}.{" "}
        <code>{"{{business_profile}}"}</code> is a bullet-point summary the AI writes from the client&apos;s website and documents.
      </p>
      <div className="flex items-center gap-3">
        <button className="btn" disabled={pending}>{pending ? "Saving…" : "Save templates"}</button>
        {state?.error && <p className="text-sm text-critical">▲ <span className="text-foreground">{state.error}</span></p>}
        {state?.saved && <p className="text-sm text-good">✓ <span className="text-foreground">Saved</span></p>}
      </div>
    </form>
  );
}

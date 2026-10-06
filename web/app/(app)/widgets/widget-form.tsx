"use client";

import { useActionState, useState } from "react";
import type { Appearance } from "@/lib/widgets";
import { saveWidget } from "./actions";

type Initial = { name: string; agentId: string; mode: "chat" | "voice" | "both"; enabled: boolean; origins: string; appearance: Appearance };

export function WidgetForm({ id, agents, initial }: { id?: string; agents: { id: string; name: string; type: string }[]; initial: Initial }) {
  const [state, action, pending] = useActionState(saveWidget.bind(null, id), undefined);
  const [mode, setMode] = useState(initial.mode);
  const [agentId, setAgentId] = useState(initial.agentId);
  const [color, setColor] = useState(initial.appearance.color);
  const [title, setTitle] = useState(initial.appearance.title);
  const agentType = agents.find((a) => a.id === agentId)?.type;

  return (
    <form action={action} className="space-y-6">
      <section className="card space-y-4">
        <h2 className="text-lg font-semibold">Setup</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <label className="label" htmlFor="w-name">Name</label>
            <input className="input" id="w-name" name="name" defaultValue={initial.name} required maxLength={100} />
          </div>
          <div className="min-w-0">
            <label className="label" htmlFor="w-agent">Agent</label>
            <select className="input" id="w-agent" name="agentId" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type === "chat" ? "chatbot" : `${a.type} voice`})</option>)}
            </select>
          </div>
        </div>
        <div>
          <p className="label">What visitors can do</p>
          <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Widget mode">
            {(
              [
                ["chat", "Chat", "A chat window."],
                ["voice", "Voice call", "Click to call: talk to the agent from the browser."],
                ["both", "Chat + call", "Both, with tabs."],
              ] as const
            ).map(([value, label, about]) => (
              <label key={value} className={`toggle-row ${mode === value ? "border-accent bg-accent/5" : ""}`}>
                <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="mt-1 accent-[var(--accent)]" />
                <span>
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="mt-0.5 block text-sm text-muted">{about}</span>
                </span>
              </label>
            ))}
          </div>
          {mode !== "chat" && agentType === "chat" && (
            <p className="mt-2 text-sm text-critical">▲ <span className="text-foreground">This agent is a chatbot. For calls, pick a voice agent so it has a voice and speech settings.</span></p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="w-origins">Allowed websites</label>
          <textarea className="input min-h-20 font-mono text-[13px]" id="w-origins" name="origins" defaultValue={initial.origins} placeholder={"https://example.com\nhttps://shop.example.com"} />
          <p className="hint">One per line. Only these sites can use the widget (www and non-www both work). Leave empty to allow any site, which isn&apos;t recommended.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="enabled" defaultChecked={initial.enabled} className="accent-[var(--accent)]" />
          Widget is on
        </label>
      </section>

      <section className="card grid gap-6 lg:grid-cols-[1fr_260px]">
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Appearance</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <label className="label" htmlFor="w-title">Title</label>
              <input className="input" id="w-title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} />
            </div>
            <div className="min-w-0">
              <label className="label" htmlFor="w-subtitle">Subtitle</label>
              <input className="input" id="w-subtitle" name="subtitle" defaultValue={initial.appearance.subtitle} maxLength={120} />
            </div>
            <div className="min-w-0">
              <label className="label" htmlFor="w-color">Colour</label>
              <div className="flex gap-2">
                <input type="color" aria-label="Pick a colour" className="h-10 w-12 rounded border border-border" value={color} onChange={(e) => setColor(e.target.value)} />
                <input className="input font-mono" id="w-color" name="color" value={color} onChange={(e) => setColor(e.target.value)} />
              </div>
            </div>
            <div className="min-w-0">
              <label className="label" htmlFor="w-position">Position</label>
              <select className="input" id="w-position" name="position" defaultValue={initial.appearance.position}>
                <option value="right">Bottom right</option>
                <option value="left">Bottom left</option>
              </select>
            </div>
            <div className="min-w-0 sm:col-span-2">
              <label className="label" htmlFor="w-launcher">Button text (optional)</label>
              <input className="input" id="w-launcher" name="launcherLabel" defaultValue={initial.appearance.launcherLabel} maxLength={40} placeholder="Talk to us" />
            </div>
          </div>
        </div>
        <div aria-hidden className="flex flex-col items-end justify-end gap-3 rounded-xl bg-surface p-4">
          <div className="w-full overflow-hidden rounded-xl bg-background shadow">
            <div className="p-3 text-white" style={{ background: color }}>
              <div className="text-sm font-semibold">{title || "Chat with us"}</div>
            </div>
            <div className="space-y-2 p-3">
              <div className="w-3/4 rounded-xl bg-surface px-2 py-1.5 text-xs">Hi! How can I help?</div>
              <div className="ml-auto w-1/2 rounded-xl px-2 py-1.5 text-xs text-white" style={{ background: color }}>Opening hours?</div>
            </div>
          </div>
          <div className="h-12 w-12 rounded-full shadow" style={{ background: color }} />
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button className="btn" disabled={pending}>{pending ? "Saving…" : id ? "Save widget" : "Create widget"}</button>
        {state?.error && <p className="text-sm text-critical">▲ <span className="text-foreground">{state.error}</span></p>}
        {state?.saved && <p className="text-sm text-good">✓ <span className="text-foreground">Saved</span></p>}
      </div>
    </form>
  );
}

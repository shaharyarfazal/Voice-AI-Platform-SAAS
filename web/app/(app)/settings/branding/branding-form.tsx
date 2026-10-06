"use client";

import { useActionState, useState } from "react";
import type { Branding } from "@/lib/workspace";
import { saveBranding } from "../actions";

type Props = { branding: Omit<Branding, "productName">; customDomain: string; appHost: string };

export function BrandingForm({ branding, customDomain, appHost }: Props) {
  const [state, action, pending] = useActionState(saveBranding, undefined);
  const [name, setName] = useState(branding.name);
  const [logo, setLogo] = useState(branding.logoUrl);
  const [color, setColor] = useState(branding.accentColor || "#2563eb");

  return (
    <form action={action} className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <div className="card space-y-4">
        <p className="text-sm text-muted">
          Your sub-accounts see this name, logo and colour instead of ours: in the dashboard, on the sign-in page at your domain,
          and on website widgets.
        </p>
        <div>
          <label className="label" htmlFor="b-name">Product name</label>
          <input className="input" id="b-name" name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Acme Voice" />
        </div>
        <div>
          <label className="label" htmlFor="b-logo">Logo URL</label>
          <input className="input" id="b-logo" name="logoUrl" value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://youragency.com/logo.png" />
          <p className="hint">A square or wide PNG/SVG on https, about 64 px tall.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="b-color">Brand colour</label>
            <div className="flex gap-2">
              <input type="color" aria-label="Pick a colour" className="h-10 w-12 rounded border border-border" value={color} onChange={(e) => setColor(e.target.value)} />
              <input className="input font-mono" id="b-color" name="accentColor" value={color} onChange={(e) => setColor(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="b-support">Support email</label>
            <input className="input" id="b-support" name="supportEmail" type="email" defaultValue={branding.supportEmail} placeholder="help@youragency.com" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="b-domain">Custom domain</label>
          <input className="input" id="b-domain" name="customDomain" defaultValue={customDomain} placeholder="app.youragency.com" />
          <p className="hint">
            Point a CNAME record for this domain at <code>{appHost}</code>, then ask your platform admin to add it to the web server
            (see docs/white-label.md). Invite links and embed code then use your domain.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="hidePoweredBy" defaultChecked={branding.hidePoweredBy} className="accent-[var(--accent)]" />
          Hide &ldquo;Powered by&rdquo; on website widgets
        </label>
        <div className="flex items-center gap-3">
          <button className="btn" disabled={pending}>{pending ? "Saving…" : "Save branding"}</button>
          {state?.error && <p className="text-sm text-critical">▲ <span className="text-foreground">{state.error}</span></p>}
          {state?.saved && <p className="text-sm text-good">✓ <span className="text-foreground">Saved</span></p>}
        </div>
      </div>
      <div className="space-y-2">
        <p className="label">Preview</p>
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="flex items-center gap-2 bg-surface p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {logo.startsWith("https://") && <img src={logo} alt="" className="h-8 w-8 rounded object-contain" />}
            <span className="font-semibold">{name || "Your product"}</span>
          </div>
          <div className="space-y-3 p-4">
            <div className="h-2 w-2/3 rounded bg-border" />
            <div className="h-2 w-1/2 rounded bg-border" />
            <span className="inline-block rounded-md px-3 py-1.5 text-sm font-medium text-white" style={{ background: color }}>Button</span>
          </div>
        </div>
      </div>
    </form>
  );
}

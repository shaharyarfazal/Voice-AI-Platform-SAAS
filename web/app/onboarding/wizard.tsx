"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Combobox } from "@/components/combobox";
import type { Choice } from "@/lib/catalog";
import { buildStatus, ensureKb, finish, saveBusiness, saveKnowledge, type BuildStatus } from "./actions";

const INDUSTRIES = ["Dental clinic", "Medical clinic", "Salon & spa", "Restaurant", "Real estate", "Law firm", "Home services", "Auto repair", "Fitness", "Hotel", "E-commerce", "Agency", "Other"];
const STEPS = ["Your business", "What the agents should know", "Building your agents"];

type Initial = { name: string; website: string; industry: string; phone: string; language: string };

export function Wizard({ initial, languages }: { initial: Initial; languages: Choice[] }) {
  const [step, setStep] = useState(0);
  const [website, setWebsite] = useState(initial.website);
  return (
    <div className="space-y-8">
      <ol className="flex gap-2" aria-label="Setup steps">
        {STEPS.map((label, i) => (
          <li key={label} className="flex-1" aria-current={i === step ? "step" : undefined}>
            <div className={`h-1.5 rounded-full ${i <= step ? "bg-accent" : "bg-border"}`} />
            <div className={`mt-2 text-xs ${i === step ? "font-medium text-foreground" : "text-muted"}`}>{i + 1}. {label}</div>
          </li>
        ))}
      </ol>
      {step === 0 && <BusinessStep initial={initial} languages={languages} onDone={(w) => { setWebsite(w); setStep(1); }} />}
      {step === 1 && <KnowledgeStep website={website} onBack={() => setStep(0)} onDone={() => setStep(2)} />}
      {step === 2 && <BuildStep />}
    </div>
  );
}

function Err({ text }: { text?: string }) {
  return text ? <p className="text-sm text-critical">▲ <span className="text-foreground">{text}</span></p> : null;
}

function BusinessStep({ initial, languages, onDone }: { initial: Initial; languages: Choice[]; onDone: (website: string) => void }) {
  const [state, action, pending] = useActionState(saveBusiness, undefined);
  const [language, setLanguage] = useState(initial.language);
  const [website, setWebsite] = useState(initial.website);
  useEffect(() => {
    if (state?.ok) onDone(website);
  }, [state, onDone, website]);

  return (
    <form
      action={action}
      className="space-y-5"
      onSubmit={(e) => {
        // The browser's time zone, for booking hours and dates.
        (e.currentTarget.elements.namedItem("timezone") as HTMLInputElement).value = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      }}
    >
      <div>
        <h1 className="text-2xl font-semibold">Tell us about your business</h1>
        <p className="mt-1 text-sm text-muted">We&apos;ll set up a phone receptionist, an outbound caller and a website chatbot for you. You can change everything later.</p>
      </div>
      <input type="hidden" name="language" value={language} />
      <input type="hidden" name="timezone" defaultValue="UTC" />
      <div>
        <label className="label" htmlFor="ob-name">Business name</label>
        <input className="input" id="ob-name" name="name" defaultValue={initial.name} required />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="min-w-0">
          <label className="label" htmlFor="ob-industry">Industry</label>
          <select className="input" id="ob-industry" name="industry" defaultValue={initial.industry}>
            <option value="">Choose…</option>
            {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
        <div className="min-w-0">
          <label className="label" htmlFor="ob-phone">Business phone (optional)</label>
          <input className="input" id="ob-phone" name="phone" defaultValue={initial.phone} placeholder="+14155550100" inputMode="tel" />
          <p className="hint">Calls are transferred here when someone asks for a person.</p>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="ob-website">Website</label>
        <input className="input" id="ob-website" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="yourbusiness.com" />
        <p className="hint">We read it so your agents know your services, prices and hours. No website? Leave it empty and upload documents next.</p>
      </div>
      <div className="min-w-0">
        <label className="label" htmlFor="ob-language">Language your customers speak</label>
        <Combobox id="ob-language" value={language} options={languages} onChange={setLanguage} searchPlaceholder="Search languages" />
      </div>
      <Err text={state?.error} />
      <button className="btn" disabled={pending}>{pending ? "Saving…" : "Continue"}</button>
    </form>
  );
}

function KnowledgeStep({ website, onBack, onDone }: { website: string; onBack: () => void; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveKnowledge, undefined);
  const [files, setFiles] = useState<{ name: string; ok: boolean; error?: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  async function upload(list: FileList) {
    setUploading(true);
    try {
      const kbId = await ensureKb();
      const form = new FormData();
      form.set("kbId", kbId);
      [...list].slice(0, 10).forEach((f) => form.append("files", f));
      const res = await fetch("/api/files/knowledge", { method: "POST", body: form });
      const body = await res.json();
      setFiles((prev) => [...prev, ...(body.results ?? [{ name: "Upload", ok: false, error: body.error }])]);
    } catch {
      setFiles((prev) => [...prev, { name: "Upload", ok: false, error: "Upload failed" }]);
    } finally {
      setUploading(false);
    }
  }

  return (
    <form action={action} className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">What should your agents know?</h1>
        <p className="mt-1 text-sm text-muted">Everything here goes into your knowledge base, which agents search while they talk.</p>
      </div>
      {website ? (
        <label className="toggle-row border-accent bg-accent/5">
          <input type="checkbox" name="readWebsite" defaultChecked className="mt-1 accent-[var(--accent)]" />
          <span>
            <span className="block text-sm font-medium">Read {website.replace(/^https?:\/\//, "")}</span>
            <span className="mt-0.5 block text-sm text-muted">Up to 40 pages: services, prices, hours, FAQs. Takes a minute or two.</span>
          </span>
        </label>
      ) : null}
      <div>
        <p className="label">Upload documents{website ? " (optional)" : ""}</p>
        <label className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed border-border p-6 text-center text-sm">
          <span className="font-medium">{uploading ? "Uploading…" : "Choose PDFs or Word documents"}</span>
          <span className="text-muted">Price lists, menus, brochures, FAQs, policies · up to 25 MB each</span>
          <input type="file" multiple accept=".pdf,.docx,.txt,.md,.csv" className="sr-only" disabled={uploading} onChange={(e) => e.target.files && void upload(e.target.files)} />
        </label>
        {files.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm">
            {files.map((f, i) => <li key={i}>{f.ok ? <span className="text-good">✓</span> : <span className="text-critical">▲</span>} {f.name}{f.error && <span className="text-muted">: {f.error}</span>}</li>)}
          </ul>
        )}
      </div>
      <div>
        <label className="label" htmlFor="ob-desc">Or describe your business{website ? " (optional)" : ""}</label>
        <textarea className="input min-h-28" id="ob-desc" name="description" placeholder="What you offer and prices, opening hours, address, how booking works, anything customers often ask…" />
      </div>
      <Err text={state?.error} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-secondary" onClick={onBack}>Back</button>
        <button className="btn" disabled={pending || uploading}>{pending ? "Saving…" : "Build my agents"}</button>
      </div>
    </form>
  );
}

function BuildStep() {
  const [status, setStatus] = useState<BuildStatus | null>(null);
  const [finishing, start] = useTransition();
  const [waitedLong, setWaitedLong] = useState(false);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const s = await buildStatus();
      if (stop) return;
      setStatus(s);
      if (s.done) start(() => finish());
      else setTimeout(tick, 2500);
    };
    void tick();
    const t = setTimeout(() => setWaitedLong(true), 90_000);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Building your agents</h1>
        <p className="mt-1 text-sm text-muted">Reading your information, writing a business profile, and creating your receptionist, outbound caller and chatbot.</p>
      </div>
      <ul className="space-y-2" aria-live="polite">
        {(status?.sources ?? []).map((s, i) => (
          <li key={i} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
            <span className="min-w-0 truncate">{s.title}</span>
            <span className={s.status === "error" ? "text-critical" : s.status === "ready" ? "text-good" : "text-muted"}>
              {s.status === "ready" ? `✓ ${s.pages > 1 ? `${s.pages} pages` : "Ready"}` : s.status === "error" ? `▲ ${s.error ?? "Couldn't read"}` : s.pages ? `Reading… ${s.pages} pages` : "Reading…"}
            </span>
          </li>
        ))}
        {status && status.sources.length === 0 && <li className="text-sm text-muted">No website or documents: your agents start with the template, and you can add knowledge any time.</li>}
        {(finishing || status?.done) && <li className="text-sm text-muted">⟳ Creating your agents…</li>}
      </ul>
      {waitedLong && !status?.done && (
        <button className="btn-secondary" onClick={() => start(() => finish())}>Continue without waiting (reading carries on in the background)</button>
      )}
    </div>
  );
}

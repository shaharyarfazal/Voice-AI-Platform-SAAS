"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import type { Hit } from "@/lib/knowledge/search";
import { addTextSource, addWebSource, testSearch } from "../actions";

/** Re-renders the page every few seconds while sources are being processed. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}

const TABS = [
  { id: "website", label: "Website" },
  { id: "files", label: "Upload files" },
  { id: "url", label: "Single page" },
  { id: "text", label: "Paste text" },
] as const;

export function AddSources({ kbId }: { kbId: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("website");
  return (
    <section className="card space-y-4">
      <h2 className="text-lg font-semibold">Add knowledge</h2>
      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-full border px-3 py-1.5 text-sm ${tab === t.id ? "border-accent bg-accent/10 font-medium" : "border-border text-muted hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "website" && <WebForm kbId={kbId} kind="website" />}
      {tab === "url" && <WebForm kbId={kbId} kind="url" />}
      {tab === "files" && <FileUpload kbId={kbId} />}
      {tab === "text" && <TextForm kbId={kbId} />}
    </section>
  );
}

function Status({ error, ok }: { error?: string; ok?: string | false }) {
  if (error) return <p className="text-sm text-critical">▲ <span className="text-foreground">{error}</span></p>;
  if (ok) return <p className="text-sm text-good">✓ <span className="text-foreground">{ok}</span></p>;
  return null;
}

function WebForm({ kbId, kind }: { kbId: string; kind: "website" | "url" }) {
  const [state, action, pending] = useActionState(addWebSource, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="kbId" value={kbId} />
      <input type="hidden" name="kind" value={kind} />
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <label className="label" htmlFor={`url-${kind}`}>{kind === "website" ? "Website address" : "Page address"}</label>
          <input className="input" id={`url-${kind}`} name="url" placeholder={kind === "website" ? "example.com" : "https://example.com/pricing"} required />
        </div>
        {kind === "website" && (
          <div>
            <label className="label" htmlFor="maxPages">Up to</label>
            <select className="input" id="maxPages" name="maxPages" defaultValue="30">
              {[10, 30, 60, 100, 200].map((n) => <option key={n} value={n}>{n} pages</option>)}
            </select>
          </div>
        )}
      </div>
      <p className="hint">{kind === "website" ? "Reads the site's pages (and PDFs it links to), following its sitemap and links. Login areas and shop carts are skipped." : "Reads just this page or PDF."}</p>
      <div className="flex items-center gap-3">
        <button className="btn" disabled={pending}>{pending ? "Adding…" : kind === "website" ? "Read website" : "Add page"}</button>
        <Status error={state?.error} ok={state?.added && "Added. It's being processed below."} />
      </div>
    </form>
  );
}

function FileUpload({ kbId }: { kbId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ name: string; ok: boolean; error?: string }[]>([]);
  const [drag, setDrag] = useState(false);

  async function upload(files: FileList | File[]) {
    const list = [...files].slice(0, 10);
    if (!list.length) return;
    setBusy(true);
    const form = new FormData();
    form.set("kbId", kbId);
    list.forEach((f) => form.append("files", f));
    try {
      const res = await fetch("/api/files/knowledge", { method: "POST", body: form });
      const body = await res.json();
      setResults(body.results ?? [{ name: "Upload", ok: false, error: body.error ?? "Upload failed" }]);
      router.refresh();
    } catch {
      setResults([{ name: "Upload", ok: false, error: "Upload failed. Check your connection." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <label
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-8 text-center text-sm ${drag ? "border-accent bg-accent/5" : "border-border"}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void upload(e.dataTransfer.files);
        }}
      >
        <span className="font-medium">{busy ? "Uploading and reading…" : "Drop files here, or click to choose"}</span>
        <span className="text-muted">PDF, Word (.docx), TXT, Markdown or CSV · up to 25 MB each · 10 at a time</span>
        <input type="file" multiple accept=".pdf,.docx,.txt,.md,.csv" className="sr-only" disabled={busy} onChange={(e) => e.target.files && void upload(e.target.files)} />
      </label>
      {results.length > 0 && (
        <ul className="space-y-1 text-sm">
          {results.map((r, i) => (
            <li key={i}>{r.ok ? <span className="text-good">✓</span> : <span className="text-critical">▲</span>} {r.name}{r.error && <span className="text-muted">: {r.error}</span>}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TextForm({ kbId }: { kbId: string }) {
  const [state, action, pending] = useActionState(addTextSource, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="kbId" value={kbId} />
      <div>
        <label className="label" htmlFor="kb-title">Title</label>
        <input className="input" id="kb-title" name="title" placeholder="Opening hours and policies" />
      </div>
      <div>
        <label className="label" htmlFor="kb-text">Text</label>
        <textarea className="input min-h-40" id="kb-text" name="text" placeholder="We're open Monday to Friday, 9am to 5pm. Cancellations need 24 hours' notice…" required />
      </div>
      <div className="flex items-center gap-3">
        <button className="btn" disabled={pending}>{pending ? "Adding…" : "Add text"}</button>
        <Status error={state?.error} ok={state?.added && "Added."} />
      </div>
    </form>
  );
}

export function TestSearch({ kbId }: { kbId: string }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="card space-y-3">
      <h2 className="text-lg font-semibold">Try a question</h2>
      <p className="text-sm text-muted">See what an agent would find for a caller&apos;s question.</p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) start(async () => setHits(await testSearch(kbId, query)));
        }}
      >
        <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="What are your opening hours?" aria-label="Question" />
        <button className="btn" disabled={pending}>{pending ? "Searching…" : "Search"}</button>
      </form>
      {hits && (hits.length === 0 ? (
        <p className="text-sm text-muted">Nothing found.</p>
      ) : (
        <ol className="space-y-3">
          {hits.map((h, i) => (
            <li key={i} className="rounded-lg bg-surface p-3 text-sm">
              <div className="mb-1 flex justify-between gap-2 text-xs text-muted">
                <span className="truncate">{h.title}</span>
                <span className="tabular-nums">score {h.score}</span>
              </div>
              <p className="line-clamp-5 whitespace-pre-line">{h.content}</p>
            </li>
          ))}
        </ol>
      ))}
    </section>
  );
}

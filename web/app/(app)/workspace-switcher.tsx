"use client";

import { useEffect, useRef, useState } from "react";
import type { WorkspaceSummary } from "@/lib/workspace";
import { switchWorkspace } from "./settings/actions";

/** Current workspace, and the others this person can open (their own and their agency's clients). */
export function WorkspaceSwitcher({ current, workspaces }: { current: { id: string; name: string }; workspaces: WorkspaceSummary[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const others = workspaces.filter((w) => w.id !== current.id);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-left text-sm"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        disabled={others.length === 0}
      >
        <span className="min-w-0">
          <span className="block text-[11px] uppercase tracking-wide text-muted">Workspace</span>
          <span className="block truncate font-medium">{current.name}</span>
        </span>
        {others.length > 0 && <span aria-hidden className="text-muted">⇅</span>}
      </button>
      {open && (
        <div role="menu" className="absolute left-0 right-0 z-40 mt-1 max-h-80 overflow-y-auto rounded-lg border border-border bg-background py-1 shadow-lg">
          {others.map((w) => (
            <form key={w.id} action={switchWorkspace}>
              <input type="hidden" name="tenantId" value={w.id} />
              <button role="menuitem" className="block w-full px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10">
                <span className="block truncate">{w.name}</span>
                <span className="block text-xs text-muted">{w.parentName ? `Client of ${w.parentName}` : w.role}</span>
              </button>
            </form>
          ))}
        </div>
      )}
    </div>
  );
}

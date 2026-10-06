"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Choice } from "@/lib/catalog";

const MAX_SHOWN = 200;

/**
 * A searchable dropdown. Options can be grouped and carry a note; with `allowCustom`, anything
 * typed that isn't in the list can be used as the value (e.g. a voice ID pasted from a provider).
 */
export function Combobox({
  id,
  value,
  options,
  onChange,
  placeholder = "Choose…",
  searchPlaceholder = "Search",
  allowCustom = false,
  customNoun = "value",
  disabled = false,
}: {
  id: string;
  value: string;
  options: Choice[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  allowCustom?: boolean;
  /** "voice ID", "model name": used in "Use … as the voice ID". */
  customNoun?: string;
  disabled?: boolean;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.value === value);
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    const words = q.split(/\s+/).filter(Boolean);
    const hits = words.length
      ? options.filter((o) => {
          const text = `${o.label} ${o.value} ${o.hint ?? ""} ${o.group ?? ""}`.toLowerCase();
          return words.every((w) => text.includes(w));
        })
      : options;
    return hits.slice(0, MAX_SHOWN);
  }, [options, q]);
  const custom = allowCustom && query.trim() && !options.some((o) => o.value === query.trim()) ? query.trim() : null;
  const count = filtered.length + (custom ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function openList() {
    if (disabled) return;
    setQuery("");
    const index = filtered.findIndex((o) => o.value === value);
    setActive(Math.max(0, index));
    setOpen(true);
  }

  function choose(v: string) {
    onChange(v);
    setOpen(false);
    document.getElementById(id)?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(count - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active < filtered.length) choose(filtered[active].value);
      else if (custom) choose(custom);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      document.getElementById(id)?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        id={id}
        className="input flex min-h-[38px] items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            openList();
          }
        }}
      >
        <span className="min-w-0 flex-1 truncate">
          {selected ? (
            <>
              {selected.label}
              {selected.hint && <span className="ml-2 text-muted">{selected.hint}</span>}
            </>
          ) : value ? (
            <span className="font-mono text-xs">{value}</span>
          ) : (
            <span className="text-muted">{placeholder}</span>
          )}
        </span>
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-muted">
          <path d="M5.5 7.5 10 12l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-lg border border-border bg-background shadow-lg">
          <div className="border-b border-border p-2">
            <input
              ref={search}
              // Focused as it mounts, so typing straight after the click lands in the search.
              autoFocus
              className="input"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={count ? `${listId}-${active}` : undefined}
              aria-label={searchPlaceholder}
              placeholder={searchPlaceholder}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          <ul ref={list} id={listId} role="listbox" className="max-h-72 overflow-y-auto py-1">
            {filtered.map((o, i) => {
              const header = o.group && o.group !== filtered[i - 1]?.group ? o.group : null;
              return (
                <li key={`${o.value}-${i}`} role="presentation">
                  {header && <div className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted">{header}</div>}
                  <div
                    id={`${listId}-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={o.value === value}
                    className={`flex cursor-pointer items-start gap-2 px-3 py-2 text-sm ${i === active ? "bg-accent/10" : ""}`}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(o.value)}
                  >
                    <span className="mt-0.5 w-4 shrink-0 text-accent">{o.value === value ? "✓" : ""}</span>
                    <span className="min-w-0">
                      <span className="block">{o.label}</span>
                      {o.hint && <span className="block text-xs text-muted">{o.hint}</span>}
                    </span>
                  </div>
                </li>
              );
            })}
            {custom && (
              <li role="presentation">
                <div
                  id={`${listId}-${filtered.length}`}
                  data-index={filtered.length}
                  role="option"
                  aria-selected={false}
                  className={`cursor-pointer px-3 py-2 text-sm ${active === filtered.length ? "bg-accent/10" : ""}`}
                  onMouseEnter={() => setActive(filtered.length)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(custom)}
                >
                  Use <span className="font-mono text-xs">{custom}</span> as the {customNoun}
                </div>
              </li>
            )}
            {count === 0 && <li className="px-3 py-3 text-sm text-muted">No matches{allowCustom ? "" : "."}</li>}
          </ul>
          {options.length > MAX_SHOWN && !q && (
            <div className="border-t border-border px-3 py-1.5 text-xs text-muted">Showing {MAX_SHOWN} of {options.length}. Type to search.</div>
          )}
        </div>
      )}
    </div>
  );
}

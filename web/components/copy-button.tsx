"use client";

import { useState } from "react";

/** Copies a value to the clipboard without showing it; the button confirms the copy. */
export function CopyButton({ value, label = "Copy", className = "btn-secondary" }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          // Clipboard API blocked (e.g. plain http): fall back to a hidden textarea.
          const t = document.createElement("textarea");
          t.value = value;
          t.style.position = "fixed";
          t.style.opacity = "0";
          document.body.appendChild(t);
          t.select();
          document.execCommand("copy");
          t.remove();
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      <span aria-live="polite">{copied ? "✓ Copied" : label}</span>
    </button>
  );
}

"use client";

import { useRef, useState, useTransition } from "react";
import { importAgentFile } from "./actions";

/** Creates an agent from an exported .json file. */
export function ImportAgentButton() {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-sm text-critical">▲ <span className="text-foreground">{error}</span></span>}
      <button type="button" className="btn-secondary" disabled={pending} onClick={() => input.current?.click()}>
        {pending ? "Importing…" : "Import"}
      </button>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        aria-label="Import an agent from a JSON file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setError(null);
          start(async () => {
            const result = await importAgentFile(await file.text());
            if (result?.error) setError(result.error);
          });
        }}
      />
    </div>
  );
}

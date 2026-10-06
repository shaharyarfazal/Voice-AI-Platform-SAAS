import { CopyButton } from "@/components/copy-button";

export function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative">
      <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-surface p-3 pr-20 text-xs leading-relaxed"><code>{code}</code></pre>
      <div className="absolute right-2 top-2">
        <CopyButton value={code} className="rounded border border-border bg-background px-2 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/10" />
      </div>
    </div>
  );
}

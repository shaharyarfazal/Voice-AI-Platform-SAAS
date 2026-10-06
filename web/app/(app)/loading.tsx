/** Shown instantly while a dashboard page loads, so navigation feels immediate. */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-48 rounded bg-surface" />
      <div className="h-4 w-80 max-w-full rounded bg-surface" />
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 rounded-xl border border-border bg-surface" />)}
      </div>
    </div>
  );
}

/** Shown instantly while a dashboard page loads, so navigation feels immediate. */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Loading">
      <div className="h-4 w-32 rounded-full bg-surface" />
      <div className="h-10 w-72 max-w-full rounded-full bg-surface" />
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="h-72 rounded-3xl bg-card shadow-soft lg:col-span-4" />
        <div className="h-72 rounded-3xl bg-card shadow-soft lg:col-span-4" />
        <div className="h-72 rounded-3xl bg-card shadow-soft lg:col-span-4" />
      </div>
    </div>
  );
}

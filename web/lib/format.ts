export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatDateTime(date: Date): string {
  return date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

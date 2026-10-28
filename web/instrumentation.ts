export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  // Serverless (Vercel): migrations run in the build step and background work runs as cron jobs.
  if (process.env.VERCEL) return;

  const { migrate } = await import("./lib/migrations");
  await migrate();

  const { startMaintenance } = await import("./lib/maintenance");
  startMaintenance();

  const { resumeKnowledgeQueue } = await import("./lib/knowledge/ingest");
  await resumeKnowledgeQueue();
}

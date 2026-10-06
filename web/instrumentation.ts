export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;

  const { migrate } = await import("./lib/migrations");
  await migrate();

  const { startMaintenance } = await import("./lib/maintenance");
  startMaintenance();

  const { resumeKnowledgeQueue } = await import("./lib/knowledge/ingest");
  await resumeKnowledgeQueue();
}

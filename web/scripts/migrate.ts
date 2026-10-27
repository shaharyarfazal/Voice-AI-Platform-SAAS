// Applies database migrations outside the server process: `npm run migrate`. Vercel runs it before
// each production build (see vercel-build in package.json), because serverless functions have no
// startup hook to do it in.
import { migrate } from "../lib/migrations";
import { sql } from "../lib/db";

async function main() {
  if (process.env.VERCEL && process.env.VERCEL_ENV !== "production" && process.env.MIGRATE_PREVIEW !== "true") {
    console.log("migrate: skipped outside production (set MIGRATE_PREVIEW=true to migrate a preview database)");
    return;
  }
  await migrate();
  console.log("migrate: database is up to date");
}

main()
  .catch((e) => {
    console.error("migrate: failed", e);
    process.exitCode = 1;
  })
  .finally(() => sql.end({ timeout: 5 }));

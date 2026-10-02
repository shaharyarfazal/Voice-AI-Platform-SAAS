import { sql } from "@/lib/db";

export async function GET() {
  await sql`SELECT 1`;
  return Response.json({ ok: true });
}

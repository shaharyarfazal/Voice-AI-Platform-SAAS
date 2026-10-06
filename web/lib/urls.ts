import "server-only";
import { sql } from "./db";
import { publicUrl } from "./oauth";

/**
 * Base URL for links people outside the dashboard open (invites, embed code): the agency's custom
 * domain when it has one, otherwise the platform's address.
 */
export async function workspaceUrl(tenantId: string): Promise<string> {
  const [row] = await sql<{ domain: string | null }[]>`
    SELECT coalesce(p.custom_domain, t.custom_domain) AS domain
    FROM tenants t LEFT JOIN tenants p ON p.id = t.parent_id WHERE t.id = ${tenantId}`;
  return row?.domain ? `https://${row.domain}` : publicUrl("/").toString().replace(/\/$/, "");
}

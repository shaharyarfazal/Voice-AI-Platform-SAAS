import "server-only";
import { headers } from "next/headers";
import { cache } from "react";
import { z } from "zod";
import type { Role } from "./auth";
import { sql } from "./db";

// Workspaces (tenants) and white-label branding. A top-level workspace can act as an agency:
// it owns sub-accounts, and its branding (name, logo, colour, custom domain) is what the
// sub-accounts' users see.

export const BrandingSchema = z.object({
  name: z.string().trim().max(60).default(""),
  logoUrl: z.union([z.literal(""), z.url().refine((u) => u.startsWith("https://"), "The logo URL must use https://")]).default(""),
  accentColor: z.union([z.literal(""), z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #2563eb")]).default(""),
  supportEmail: z.union([z.literal(""), z.email()]).default(""),
  /** Hides "Powered by" on widgets. */
  hidePoweredBy: z.boolean().default(false),
});
export type Branding = z.infer<typeof BrandingSchema> & { productName: string };

export const PLATFORM_NAME = process.env.PLATFORM_NAME || "Voice AI";

function toBranding(raw: unknown): Branding {
  const b = BrandingSchema.parse(raw ?? {});
  return { ...b, productName: b.name || PLATFORM_NAME };
}

/** The branding a workspace's users see: its agency's, or its own if it's top-level. */
export const brandingFor = cache(async (tenantId: string): Promise<Branding> => {
  const [row] = await sql<{ own: unknown; parent: unknown | null }[]>`
    SELECT t.branding AS own, p.branding AS parent FROM tenants t LEFT JOIN tenants p ON p.id = t.parent_id WHERE t.id = ${tenantId}`;
  return toBranding(row?.parent ?? row?.own);
});

/** Branding for the sign-in pages, from a custom domain pointed at the platform. */
export const brandingForHost = cache(async (): Promise<Branding> => {
  const host = ((await headers()).get("host") ?? "").split(":")[0].toLowerCase();
  if (!host) return toBranding({});
  const [row] = await sql<{ branding: unknown }[]>`SELECT branding FROM tenants WHERE custom_domain = ${host} AND parent_id IS NULL`;
  return toBranding(row?.branding);
});

export type WorkspaceSummary = { id: string; name: string; role: Role; parentName: string | null };

/** Every workspace a person can switch to: their memberships, plus sub-accounts of agencies they manage. */
export async function listWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
  return sql<WorkspaceSummary[]>`
    SELECT t.id, t.name, m.role, p.name AS "parentName"
    FROM memberships m JOIN tenants t ON t.id = m.tenant_id LEFT JOIN tenants p ON p.id = t.parent_id
    WHERE m.user_id = ${userId}
    UNION
    SELECT c.id, c.name, m.role, t.name AS "parentName"
    FROM memberships m JOIN tenants t ON t.id = m.tenant_id JOIN tenants c ON c.parent_id = t.id
    WHERE m.user_id = ${userId} AND m.role IN ('owner', 'admin')
    ORDER BY "parentName" NULLS FIRST, name`;
}

export async function isTopLevel(tenantId: string): Promise<boolean> {
  const [row] = await sql<{ parent_id: string | null }[]>`SELECT parent_id FROM tenants WHERE id = ${tenantId}`;
  return Boolean(row) && row.parent_id === null;
}

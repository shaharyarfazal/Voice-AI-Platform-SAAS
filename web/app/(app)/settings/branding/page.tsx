import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { sql } from "@/lib/db";
import { publicUrl } from "@/lib/oauth";
import { BrandingSchema, isTopLevel } from "@/lib/workspace";
import { BrandingForm } from "./branding-form";

export default async function BrandingPage() {
  const session = await requireRole("admin");
  if (!(await isTopLevel(session.tenantId))) notFound();
  const [t] = await sql<{ branding: unknown; custom_domain: string | null }[]>`SELECT branding, custom_domain FROM tenants WHERE id = ${session.tenantId}`;
  const appHost = publicUrl("/").host;
  return <BrandingForm branding={BrandingSchema.parse(t.branding ?? {})} customDomain={t.custom_domain ?? ""} appHost={appHost} />;
}

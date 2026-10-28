import "server-only";
import { notFound } from "next/navigation";

/**
 * The brand this deployment serves (HVAC, Limo, ...). Every niche app on Vercel sets BRAND_ID; the
 * workspaces it creates are tagged with it, and its billing catalog and defaults follow from it.
 */
export function currentBrand(): string {
  return process.env.BRAND_ID || "default";
}

/** Brand-only pages: a 404 on every other brand's deployment. */
export function requireBrand(brand: string): void {
  if (currentBrand() !== brand) notFound();
}

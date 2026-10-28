import "server-only";

/**
 * The brand this deployment serves (HVAC, Limo, ...). Every niche app on Vercel sets BRAND_ID; the
 * workspaces it creates are tagged with it, and its billing catalog and defaults follow from it.
 */
export function currentBrand(): string {
  return process.env.BRAND_ID || "default";
}

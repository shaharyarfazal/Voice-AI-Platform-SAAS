import { hvac } from "./hvac";
import type { BrandModule } from "./types";

// Every brand module is registered here so any deployment can still price and template a workspace
// of another brand (the platform admin sees all of them).
const BRANDS: Record<string, BrandModule> = { hvac };

export function brandModule(brand: string | null | undefined): BrandModule {
  return (brand && BRANDS[brand]) || {};
}

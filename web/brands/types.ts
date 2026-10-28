import type { IconName } from "@/components/icons";
import type { BillingCatalogInput } from "@/lib/billing/catalog";
import type { Templates } from "@/lib/templates";

export type NavItem = { href: string; label: string; icon: IconName };
export type NavGroup = { label?: string; items: NavItem[] };

/**
 * What a niche (HVAC, Limo, ...) adds to the shared app. A deployment loads the module named by its
 * BRAND_ID; every field is optional and falls back to the platform default.
 *
 * Brand-only pages go under app/(app)/<brand>/, whose layout calls requireBrand("<brand>") so other
 * deployments return 404 for them. Link them from `nav`.
 */
export type BrandModule = {
  /** Starting prompts for the agents the setup wizard creates. Admin > Templates can still edit them. */
  templates?: Templates;
  /** The industry choices in the setup wizard. */
  industries?: string[];
  /** Plans and credit packs. Parsed with CatalogSchema, so defaulted fields can be left out. */
  catalog?: BillingCatalogInput;
  /** Extra sidebar groups, shown after the main ones. */
  nav?: NavGroup[];
};

import { z } from "zod";
import { brandModule } from "@/brands";

// What each brand sells: subscription plans (monthly, with included credits) and one-off credit
// packs. One credit is one minute of voice call time at the default rate; a workspace's
// `credits_per_minute` can price it differently.
//
// Prices are passed to Stripe Checkout as inline price data, so there is nothing to create in the
// Stripe dashboard first. A brand (HVAC, Limo, ...) sets its catalog in its module under brands/; a
// deployment can also override the default catalog with the BILLING_CATALOG environment variable
// (JSON in this shape).

const PlanSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  /** Monthly price in the smallest currency unit (cents). */
  priceCents: z.number().int().positive(),
  /** Credits included every billing period. Unused ones expire at renewal. */
  credits: z.number().positive(),
  description: z.string().default(""),
  features: z.array(z.string()).default([]),
  highlighted: z.boolean().default(false),
});

const PackSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  credits: z.number().positive(),
  priceCents: z.number().int().positive(),
});

export const CatalogSchema = z.object({
  currency: z.string().length(3).default("usd"),
  /** Granted once to a new workspace so it can try the product before paying. */
  trialCredits: z.number().nonnegative().default(0),
  /** Credits one chatbot reply costs. */
  chatReplyCredits: z.number().nonnegative().default(0.05),
  /** Monthly price of a phone number bought through the platform, in cents, taken from credits. */
  phoneNumberCents: z.number().int().nonnegative().default(200),
  plans: z.array(PlanSchema),
  packs: z.array(PackSchema).min(1),
});

export type Plan = z.infer<typeof PlanSchema>;
export type CreditPack = z.infer<typeof PackSchema>;
export type BillingCatalog = z.infer<typeof CatalogSchema>;
/** A catalog as written, before CatalogSchema fills in the defaults. */
export type BillingCatalogInput = z.input<typeof CatalogSchema>;

// Placeholder prices: replace them with your own before launch.
const DEFAULT_CATALOG: BillingCatalog = CatalogSchema.parse({
  currency: "usd",
  trialCredits: 30,
  chatReplyCredits: 0.05,
  plans: [
    {
      id: "starter",
      name: "Starter",
      priceCents: 4900,
      credits: 250,
      description: "One location getting started with AI call answering.",
      features: ["250 call minutes a month", "1 phone number", "Website chatbot", "Calendar booking"],
    },
    {
      id: "growth",
      name: "Growth",
      priceCents: 14900,
      credits: 900,
      highlighted: true,
      description: "Busy teams that never want to miss a call.",
      features: ["900 call minutes a month", "3 phone numbers", "Outbound calls", "Call recordings and analysis"],
    },
    {
      id: "pro",
      name: "Pro",
      priceCents: 39900,
      credits: 2600,
      description: "Multiple locations and high call volume.",
      features: ["2,600 call minutes a month", "10 phone numbers", "API and webhooks", "Priority support"],
    },
  ],
  packs: [
    { id: "100", credits: 100, priceCents: 2500 },
    { id: "500", credits: 500, priceCents: 11000 },
    { id: "2000", credits: 2000, priceCents: 40000 },
  ],
});

const registered = new Map<string, BillingCatalog>();

/** Lets a brand package register its catalog in code instead of through the environment. */
export function registerCatalog(brand: string, catalog: BillingCatalog): void {
  registered.set(brand, CatalogSchema.parse(catalog));
}

let fromEnv: BillingCatalog | null | undefined;

function envCatalog(): BillingCatalog | null {
  if (fromEnv === undefined) {
    const raw = process.env.BILLING_CATALOG;
    fromEnv = raw ? CatalogSchema.parse(JSON.parse(raw)) : null;
  }
  return fromEnv;
}

function moduleCatalog(brand: string): BillingCatalog | undefined {
  const raw = brandModule(brand).catalog;
  if (raw && !registered.has(brand)) registered.set(brand, CatalogSchema.parse(raw));
  return registered.get(brand);
}

export function catalogFor(brand: string | null | undefined): BillingCatalog {
  return (brand && (registered.get(brand) || moduleCatalog(brand))) || envCatalog() || DEFAULT_CATALOG;
}

export function findPlan(catalog: BillingCatalog, id: string | null | undefined): Plan | undefined {
  return catalog.plans.find((p) => p.id === id);
}

export function findPack(catalog: BillingCatalog, id: string | null | undefined): CreditPack | undefined {
  return catalog.packs.find((p) => p.id === id);
}

/**
 * Credits a bought phone number costs each month: its price at the smallest credit pack's rate,
 * rounded up to a tenth of a credit.
 */
export function phoneNumberCredits(catalog: BillingCatalog): number {
  const pack = [...catalog.packs].sort((a, b) => a.credits - b.credits)[0];
  return Math.ceil((catalog.phoneNumberCents * pack.credits * 10) / pack.priceCents) / 10;
}

export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
}

import type { BrandModule } from "../types";
import { templates } from "./templates";

// HVAC: heating and cooling contractors. Pricing follows docs/marketing/hvac-website-research.md
// (Starter / Pro / Growth); the credit packs are priced at about the Starter per-minute rate.
export const hvac: BrandModule = {
  templates,
  industries: ["Residential HVAC", "Commercial HVAC", "HVAC & plumbing", "HVAC & electrical", "Refrigeration", "Other"],
  catalog: {
    currency: "usd",
    trialCredits: 30,
    plans: [
      {
        id: "starter",
        name: "Starter",
        priceCents: 14900,
        credits: 300,
        description: "Owner-operators and shops with 1–3 trucks.",
        features: ["300 call minutes a month", "24/7 answering in English & Spanish", "Emergency triage and transfer", "Books into Google or Outlook calendar"],
      },
      {
        id: "pro",
        name: "Pro",
        priceCents: 29700,
        credits: 800,
        highlighted: true,
        description: "Growing shops with 4–15 trucks.",
        features: ["800 call minutes a month", "Everything in Starter", "Website chat and call widget", "Tune-up reminders and estimate follow-up calls"],
      },
      {
        id: "growth",
        name: "Growth",
        priceCents: 49700,
        credits: 1800,
        description: "Multi-location contractors with 15+ trucks.",
        features: ["1,800 call minutes a month", "Everything in Pro", "Field service software integration, set up for you", "Multiple numbers and locations"],
      },
    ],
    packs: [
      { id: "100", credits: 100, priceCents: 4900 },
      { id: "500", credits: 500, priceCents: 22500 },
      { id: "2000", credits: 2000, priceCents: 80000 },
    ],
  },
  // HVAC-only pages (dispatch board, maintenance plans, service areas) are linked here as they're built.
  nav: [],
};

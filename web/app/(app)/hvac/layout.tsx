import { requireBrand } from "@/lib/brand";

// HVAC-only pages live under /hvac. Other brands' deployments answer 404 here.
export default function HvacLayout({ children }: { children: React.ReactNode }) {
  requireBrand("hvac");
  return children;
}

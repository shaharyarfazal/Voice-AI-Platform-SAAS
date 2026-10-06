"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Tab-style links between the pages of one section. */
export function SubNav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex overflow-x-auto border-b border-border" aria-label="Section">
      {items.map((i) => {
        const active = pathname === i.href;
        return (
          <Link key={i.href} href={i.href} className="tab" aria-selected={active} aria-current={active ? "page" : undefined}>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}

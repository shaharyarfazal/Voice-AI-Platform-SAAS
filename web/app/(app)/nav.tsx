"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Overview", icon: "◧" },
  { href: "/agents", label: "Agents", icon: "◉" },
  { href: "/numbers", label: "Phone numbers", icon: "☏" },
  { href: "/calls", label: "Calls", icon: "≡" },
  { href: "/appointments", label: "Appointments", icon: "▦" },
  { href: "/integrations", label: "Integrations", icon: "⚭" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col">
      {ITEMS.map((i) => {
        const active = i.href === "/" ? pathname === "/" : pathname.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} className="nav-link" aria-current={active ? "page" : undefined}>
            <span aria-hidden className="w-4 text-center">{i.icon}</span>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const GROUPS = [
  {
    items: [
      { href: "/", label: "Overview", icon: "◧" },
      { href: "/agents", label: "Voice agents", icon: "◉" },
      { href: "/chatbots", label: "Chatbots", icon: "✎" },
      { href: "/knowledge", label: "Knowledge base", icon: "❏" },
      { href: "/widgets", label: "Widgets", icon: "◫" },
    ],
  },
  {
    label: "Activity",
    items: [
      { href: "/calls", label: "Calls & chats", icon: "≡" },
      { href: "/appointments", label: "Appointments", icon: "▦" },
    ],
  },
  {
    label: "Setup",
    items: [
      { href: "/numbers", label: "Phone numbers", icon: "☏" },
      { href: "/integrations", label: "Integrations", icon: "⚭" },
      { href: "/settings", label: "Settings", icon: "⚙" },
      { href: "/docs", label: "API docs", icon: "{}" },
    ],
  },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col md:gap-4">
      {GROUPS.map((g, i) => (
        <div key={i} className="flex gap-1 md:flex-col">
          {g.label && <div className="hidden px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted md:block">{g.label}</div>}
          {g.items.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className="nav-link whitespace-nowrap" aria-current={active ? "page" : undefined}>
                <span aria-hidden className="w-4 text-center text-xs">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

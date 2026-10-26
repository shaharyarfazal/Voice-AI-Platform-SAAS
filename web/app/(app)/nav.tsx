"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/icons";

type Item = { href: string; label: string; icon: IconName };

const GROUPS: { label?: string; items: Item[] }[] = [
  {
    items: [
      { href: "/", label: "Overview", icon: "overview" },
      { href: "/agents", label: "Voice agents", icon: "agent" },
      { href: "/chatbots", label: "Chatbots", icon: "chat" },
      { href: "/knowledge", label: "Knowledge base", icon: "knowledge" },
      { href: "/widgets", label: "Widgets", icon: "widget" },
    ],
  },
  {
    label: "Activity",
    items: [
      { href: "/calls", label: "Calls & chats", icon: "calls" },
      { href: "/schedule", label: "Schedule", icon: "schedule" },
      { href: "/appointments", label: "Appointments", icon: "appointments" },
    ],
  },
  {
    label: "Setup",
    items: [
      { href: "/numbers", label: "Phone numbers", icon: "phone" },
      { href: "/integrations", label: "Integrations", icon: "integrations" },
      { href: "/billing", label: "Billing", icon: "billing" },
      { href: "/settings", label: "Settings", icon: "settings" },
      { href: "/docs", label: "API docs", icon: "docs" },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function Nav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-4">
      {GROUPS.map((g, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          {g.label && <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted">{g.label}</div>}
          {g.items.map((item) => (
            <Link key={item.href} href={item.href} prefetch className="nav-link" aria-current={isActive(pathname, item.href) ? "page" : undefined}>
              <Icon name={item.icon} className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

/** Phones: a top bar with a menu button; the sidebar slides in as a drawer. */
export function MobileShell({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname();
  // Remembering where the drawer was opened closes it as soon as a link navigates elsewhere.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (value: boolean) => setOpenOn(value ? pathname : null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenOn(null);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <div className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="min-w-0 truncate text-sm font-semibold">{title}</div>
        <button type="button" className="rounded-md p-2 hover:bg-black/5 dark:hover:bg-white/10" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
          <Icon name="menu" className="h-5 w-5" />
        </button>
      </div>
      {open && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" aria-hidden onClick={() => setOpen(false)} />}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-border bg-surface transition-transform md:sticky md:top-0 md:z-auto md:h-screen md:w-60 md:max-w-none md:shrink-0 md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
        aria-label="Sidebar"
      >
        <button type="button" className="absolute top-3 right-3 rounded-md p-2 hover:bg-black/5 md:hidden dark:hover:bg-white/10" aria-label="Close menu" onClick={() => setOpen(false)}>
          <Icon name="close" className="h-5 w-5" />
        </button>
        {children}
      </aside>
    </>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { NavGroup } from "@/brands/types";
import { Icon } from "@/components/icons";

const GROUPS: NavGroup[] = [
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

/** Remembers whether the desktop sidebar shows labels; read by the layout so the first paint matches. */
export const RAIL_COOKIE = "rail";

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * `extra`: the brand's own groups (brands/<brand>), shown after the main ones.
 * Links use the default prefetch: dynamic pages prefetch only up to their loading state, so a page
 * load no longer renders every page in the sidebar on the server.
 */
export function Nav({ extra = [] }: { extra?: NavGroup[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-3">
      {[...GROUPS, ...extra].map((g, i) => (
        <div key={i} className="flex flex-col gap-1">
          {g.label && <div className="rail-label px-3 pb-0.5 text-[11px] font-medium tracking-wide text-muted uppercase">{g.label}</div>}
          {i > 0 && <div aria-hidden className="rail-divider mx-auto my-1 hidden h-px w-6 bg-border" />}
          {g.items.map((item) => (
            <Link key={item.href} href={item.href} className="nav-link rail-item" data-tip={item.label} aria-current={isActive(pathname, item.href) ? "page" : undefined}>
              <Icon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
              <span className="rail-label truncate">{item.label}</span>
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

/**
 * Desktop: a slim icon rail (labels on hover) that can expand to show labels.
 * Phones: a top bar with a menu button; the sidebar slides in as a drawer, always labelled.
 */
export function MobileShell({ title, children, initialCollapsed = true }: { title: React.ReactNode; children: React.ReactNode; initialCollapsed?: boolean }) {
  const pathname = usePathname();
  // Remembering where the drawer was opened closes it as soon as a link navigates elsewhere.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (value: boolean) => setOpenOn(value ? pathname : null);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const aside = useRef<HTMLElement>(null);
  const [tip, setTip] = useState<{ text: string; top: number; left: number } | null>(null);

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

  // Labels for the icon rail. A fixed tooltip, because the rail scrolls and would clip one inside it.
  useEffect(() => {
    const el = aside.current;
    if (!el || !collapsed) return;
    const show = (e: Event) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
      if (!target || !window.matchMedia("(min-width: 48rem)").matches) return setTip(null);
      const r = target.getBoundingClientRect();
      setTip({ text: target.dataset.tip!, top: r.top + r.height / 2, left: r.right + 10 });
    };
    const hide = () => setTip(null);
    el.addEventListener("mouseover", show);
    el.addEventListener("focusin", show);
    el.addEventListener("mouseleave", hide);
    el.addEventListener("focusout", hide);
    el.addEventListener("scroll", hide, true);
    return () => {
      el.removeEventListener("mouseover", show);
      el.removeEventListener("focusin", show);
      el.removeEventListener("mouseleave", hide);
      el.removeEventListener("focusout", hide);
      el.removeEventListener("scroll", hide, true);
    };
  }, [collapsed]);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    setTip(null);
    document.cookie = `${RAIL_COOKIE}=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <>
      <div className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="min-w-0 truncate text-sm font-semibold">{title}</div>
        <button type="button" className="icon-btn" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
          <Icon name="menu" className="h-5 w-5" />
        </button>
      </div>
      {open && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" aria-hidden onClick={() => setOpen(false)} />}
      <aside
        ref={aside}
        data-rail={collapsed ? "collapsed" : "expanded"}
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-background transition-[transform,width] md:sticky md:top-3 md:z-auto md:h-[calc(100vh-1.5rem)] md:max-w-none md:shrink-0 md:translate-x-0 md:bg-transparent ${collapsed ? "md:w-[84px]" : "md:w-60"} ${open ? "translate-x-0" : "-translate-x-full"}`}
        aria-label="Sidebar"
      >
        <button type="button" className="icon-btn absolute top-3 right-3 md:hidden" aria-label="Close menu" onClick={() => setOpen(false)}>
          <Icon name="close" className="h-5 w-5" />
        </button>
        {children}
        <div className="hidden px-3 pb-4 md:block">
          <button type="button" onClick={toggle} className="nav-link rail-item w-full" data-tip="Show labels" aria-label={collapsed ? "Show sidebar labels" : "Hide sidebar labels"} aria-pressed={!collapsed}>
            <Icon name={collapsed ? "expand" : "collapse"} className="h-[18px] w-[18px] shrink-0" />
            <span className="rail-label">Collapse</span>
          </button>
        </div>
      </aside>
      {tip && (
        <div role="tooltip" className="pointer-events-none fixed z-[60] -translate-y-1/2 rounded-full bg-accent px-3 py-1.5 text-xs font-medium whitespace-nowrap text-on-accent shadow-soft" style={{ top: tip.top, left: tip.left }}>
          {tip.text}
        </div>
      )}
    </>
  );
}

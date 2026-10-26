import { SubNav } from "@/components/sub-nav";

export default function ScheduleLayout({ children }: LayoutProps<"/schedule">) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Schedule</h1>
        <p className="page-sub">Jobs booked by your voice agents and your team, on one calendar.</p>
      </div>
      <SubNav
        items={[
          { href: "/schedule", label: "Calendar" },
          { href: "/schedule/team", label: "Team" },
          { href: "/schedule/settings", label: "Services & settings" },
        ]}
      />
      {children}
    </div>
  );
}

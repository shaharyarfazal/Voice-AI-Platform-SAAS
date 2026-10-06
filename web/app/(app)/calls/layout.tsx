import { SubNav } from "@/components/sub-nav";

export default function CallsLayout({ children }: LayoutProps<"/calls">) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Calls &amp; chats</h1>
        <p className="page-sub">Every phone call, web call and chat conversation, with transcripts.</p>
      </div>
      <SubNav items={[{ href: "/calls", label: "Calls" }, { href: "/calls/chats", label: "Chats" }]} />
      {children}
    </div>
  );
}

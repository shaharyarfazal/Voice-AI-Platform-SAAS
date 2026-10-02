import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Voice AI Platform",
  description: "AI voice agents for phone and web calls",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import "@/app/tokens.css";

export const metadata: Metadata = {
  title: "Decisions · Laniameda",
  description: "Each world's Inbox: the decisions agents prepared for you.",
  robots: { index: false, follow: false },
};

// Cards are a full-screen gesture surface on a phone.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function InboxLayout({ children }: { children: React.ReactNode }) {
  return children;
}
